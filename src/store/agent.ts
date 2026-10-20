// rAImy Agent conversations and the tool loop.
//
// `messages` is exactly what is sent to the API and is only ever appended to:
// earlier turns, the system prompt and the tool list never change within a
// conversation, which keeps prompt caching and replayed thinking valid.

import { create } from "zustand";
import { contentToEcho, TurnAccumulator, type Block, type ToolUseBlock, type Usage } from "@/features/agent/accumulator";
import { CONTEXT_TAG, NEEDS_APPROVAL, SYSTEM_PROMPT, TOOLS } from "@/features/agent/definition";
import { runTool, type ToolOutcome } from "@/features/agent/tools";
import { toAppError } from "@/lib/errors";
import { Channel, ipc } from "@/lib/ipc";
import { locationDisplay } from "@/lib/paths";
import { useDesktop } from "@/store/desktop";
import { useStudio } from "@/store/studio";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, useWsl } from "@/store/wsl";
import type { AgentConfigureRequest, AgentStatus } from "@/types/ipc";

export interface UserText {
  type: "text";
  text: string;
}
export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ApiMessage =
  | { role: "user"; content: (UserText | ToolResult)[] }
  | { role: "assistant"; content: Block[] };

export type ToolStatus = "awaiting" | "running" | "done" | "error" | "refused";

export interface ToolState {
  status: ToolStatus;
  outcome?: ToolOutcome;
}

export interface Note {
  /** Shown after `messages[afterIndex]`. */
  afterIndex: number;
  kind: "error" | "interrupted" | "refusal" | "info";
  text: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messages: ApiMessage[];
  tools: Record<string, ToolState>;
  notes: Note[];
  autoApprove: boolean;
  usage: { input: number; output: number; cached: number };
}

export interface LiveTurn {
  convId: string;
  blocks: Block[];
  /** Raw JSON received so far for each streaming tool input, by tool id. */
  partial: Record<string, string>;
}

interface AgentStore {
  status: AgentStatus | null;
  statusError: string | null;
  conversations: Conversation[];
  activeId: string | null;
  runningId: string | null;
  live: LiveTurn | null;
  draft: string;

  loadStatus: () => Promise<void>;
  configure: (req: AgentConfigureRequest) => Promise<string | null>;
  newConversation: () => string;
  select: (id: string) => void;
  remove: (id: string) => void;
  setDraft: (text: string) => void;
  setAutoApprove: (id: string, on: boolean) => void;
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  answer: (toolId: string, approved: boolean) => void;
}

const MAX_STEPS = 24;
const approvals = new Map<string, (ok: boolean) => void>();
let currentRequest: string | null = null;
let stopRequested = false;

function blankConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "",
    createdAt: Date.now(),
    messages: [],
    tools: {},
    notes: [],
    autoApprove: false,
    usage: { input: 0, output: 0, cached: 0 },
  };
}

/** French, actionable text for a failed request. */
export function friendlyError(e: unknown): string {
  const err = toAppError(e);
  const m = err.message;
  if (/no API key configured/i.test(m))
    return "Aucune clé API n'est configurée. Ouvrez les réglages de rAImy Agent (icône ⚙) et collez votre clé Anthropic.";
  if (/HTTP 401/.test(m)) return "Clé API refusée (401). Vérifiez-la dans les réglages de rAImy Agent.";
  if (/HTTP 403/.test(m)) return "Accès refusé (403) : cette clé n'a pas accès à ce modèle.";
  if (/HTTP 429|rate_limit/.test(m)) return "Limite de requêtes atteinte. Patientez un peu puis réessayez.";
  if (/HTTP 529|overloaded/.test(m)) return "L'API Claude est momentanément surchargée. Réessayez dans quelques instants.";
  if (/could not reach|connection lost/i.test(m))
    return "Impossible de joindre api.anthropic.com. Vérifiez votre connexion Internet puis réessayez.";
  if (/too large/i.test(m)) return "La conversation est devenue trop longue. Commencez une nouvelle conversation.";
  if (err.kind === "unknown" && /invoke|__TAURI__|window\./i.test(m))
    return "rAImy Agent fonctionne dans l'application de bureau rAImy OS (pas dans un simple navigateur).";
  return m.replace(/^rAImy Agent: /, "");
}

function contextBlock(): string {
  const lines: string[] = [];
  const now = new Date();
  lines.push(
    `Date : ${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
  );
  const distro = chooseDistro(useWsl.getState().status);
  lines.push(distro ? `Distribution WSL : ${distro}` : "WSL : aucune distribution détectée");
  const project = useWorkspace.getState().project;
  if (project) lines.push(`Projet ouvert : ${locationDisplay(project)}`);
  const studio = useStudio.getState();
  const tab = studio.tabs.find((t) => t.id === studio.activeId);
  if (tab) {
    const where = tab.location ? locationDisplay(tab.location) : "non enregistré";
    const dirty = tab.location ? tab.content !== tab.saved : true;
    lines.push(`Code Studio : fichier actif ${tab.name} (${where})${dirty ? ", modifications non enregistrées" : ""}`);
  }
  return `<${CONTEXT_TAG}>\n${lines.join("\n")}\n</${CONTEXT_TAG}>`;
}

function hasRequired(name: string, input: Record<string, unknown>): boolean {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return false;
  const required = (tool.input_schema as { required?: readonly string[] }).required ?? [];
  return required.every((k) => typeof input[k] === "string");
}

export const useAgent = create<AgentStore>((set, get) => {
  const patchConv = (id: string, fn: (c: Conversation) => Conversation) =>
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)) }));
  const conv = (id: string) => get().conversations.find((c) => c.id === id);
  const addNote = (id: string, kind: Note["kind"], text: string) =>
    patchConv(id, (c) => ({ ...c, notes: [...c.notes, { afterIndex: c.messages.length - 1, kind, text }] }));
  const setTool = (id: string, toolId: string, state: ToolState) =>
    patchConv(id, (c) => ({ ...c, tools: { ...c.tools, [toolId]: state } }));

  async function execute(convId: string, tu: ToolUseBlock, invalidRaw: string | undefined, truncated: boolean): Promise<ToolResult> {
    if (invalidRaw !== undefined || truncated || !hasRequired(tu.name, tu.input)) {
      const outcome: ToolOutcome = { content: "Paramètres invalides ou incomplets.", isError: true };
      setTool(convId, tu.id, { status: "error", outcome });
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: true,
        content: JSON.stringify({ INVALID_JSON: invalidRaw ?? JSON.stringify(tu.input) }),
      };
    }
    if (NEEDS_APPROVAL.has(tu.name) && !conv(convId)?.autoApprove) {
      setTool(convId, tu.id, { status: "awaiting" });
      const ok = stopRequested ? false : await new Promise<boolean>((resolve) => approvals.set(tu.id, resolve));
      approvals.delete(tu.id);
      if (!ok) {
        setTool(convId, tu.id, { status: "refused" });
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: true,
          content: "L'utilisateur a refusé cette action. Demande-lui comment il souhaite continuer.",
        };
      }
    }
    setTool(convId, tu.id, { status: "running" });
    const outcome = await runTool(tu.name, tu.input);
    setTool(convId, tu.id, { status: outcome.isError ? "error" : "done", outcome });
    return { type: "tool_result", tool_use_id: tu.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) };
  }

  async function loop(convId: string): Promise<void> {
    stopRequested = false;
    set({ runningId: convId });
    try {
      for (let step = 0; step < MAX_STEPS && !stopRequested; step++) {
        const c = conv(convId);
        if (!c) return;
        const acc = new TurnAccumulator();
        const requestId = crypto.randomUUID();
        currentRequest = requestId;
        const channel = new Channel<Record<string, unknown>>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          timer = undefined;
          const partial: Record<string, string> = {};
          acc.blocks.forEach((b, i) => {
            const raw = b?.type === "tool_use" ? acc.partialInput(i) : undefined;
            if (raw !== undefined) partial[(b as ToolUseBlock).id] = raw;
          });
          set({ live: { convId, blocks: acc.content().map((b) => ({ ...b })), partial } });
        };
        channel.onmessage = (ev) => {
          acc.handle(ev);
          timer ??= setTimeout(flush, 40);
        };
        set({ live: { convId, blocks: [], partial: {} } });

        let completed = false;
        try {
          completed = await ipc.agentStream({ requestId, system: SYSTEM_PROMPT, tools: [...TOOLS], messages: c.messages }, channel);
        } catch (e) {
          clearTimeout(timer);
          addNote(convId, "error", friendlyError(e));
          return;
        } finally {
          clearTimeout(timer);
          currentRequest = null;
          set({ live: null });
        }

        const u: Usage = acc.usage;
        patchConv(convId, (x) => ({
          ...x,
          usage: {
            input: x.usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            output: x.usage.output + (u.output_tokens ?? 0),
            cached: x.usage.cached + (u.cache_read_input_tokens ?? 0),
          },
        }));

        if (!completed || stopRequested) {
          const partialText = acc
            .content()
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("\n")
            .trim();
          addNote(convId, "interrupted", partialText);
          return;
        }
        if (acc.stopReason === "refusal") {
          const explanation = (acc.stopDetails?.explanation as string | undefined) ?? "";
          addNote(
            convId,
            "refusal",
            `Le modèle a décliné cette demande.${explanation ? ` ${explanation}` : ""} Reformulez-la ou commencez une nouvelle conversation.`,
          );
          return;
        }

        const content = contentToEcho(acc.content());
        if (content.length === 0) {
          addNote(convId, "info", "Réponse vide. Réessayez.");
          return;
        }
        patchConv(convId, (x) => ({ ...x, messages: [...x.messages, { role: "assistant", content }] }));

        const uses = content.filter((b): b is ToolUseBlock => b.type === "tool_use");
        if (uses.length === 0) return;
        const truncated = acc.stopReason === "max_tokens";
        const results = await Promise.all(uses.map((tu) => execute(convId, tu, acc.invalidInputs.get(tu.id), truncated)));
        // Results always go back, even after "stop", so the conversation stays valid.
        patchConv(convId, (x) => ({ ...x, messages: [...x.messages, { role: "user", content: results }] }));
      }
      if (!stopRequested) addNote(convId, "info", "L'agent s'est arrêté après de nombreuses étapes. Envoyez « continue » pour poursuivre.");
    } finally {
      set({ runningId: null, live: null });
    }
  }

  return {
    status: null,
    statusError: null,
    conversations: [],
    activeId: null,
    runningId: null,
    live: null,
    draft: "",

    loadStatus: async () => {
      try {
        set({ status: await ipc.agentStatus(), statusError: null });
      } catch (e) {
        set({ statusError: friendlyError(e) });
      }
    },

    configure: async (req) => {
      try {
        set({ status: await ipc.agentConfigure(req), statusError: null });
        return null;
      } catch (e) {
        return toAppError(e).message;
      }
    },

    newConversation: () => {
      const existing = get().conversations.find((c) => c.messages.length === 0);
      if (existing) {
        set({ activeId: existing.id });
        return existing.id;
      }
      const c = blankConversation();
      set((s) => ({ conversations: [c, ...s.conversations], activeId: c.id }));
      return c.id;
    },

    select: (activeId) => set({ activeId }),

    remove: (id) => {
      if (get().runningId === id) return;
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        return { conversations, activeId: s.activeId === id ? (conversations[0]?.id ?? null) : s.activeId };
      });
    },

    setDraft: (draft) => set({ draft }),

    setAutoApprove: (id, on) => patchConv(id, (c) => ({ ...c, autoApprove: on })),

    send: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().runningId) return;
      let id = get().activeId;
      if (!id || !conv(id)) id = get().newConversation();
      const message: ApiMessage = {
        role: "user",
        content: [
          { type: "text", text: trimmed },
          { type: "text", text: contextBlock() },
        ],
      };
      patchConv(id, (c) => ({
        ...c,
        title: c.title || trimmed.replace(/\s+/g, " ").slice(0, 64),
        messages: [...c.messages, message],
      }));
      set({ draft: "" });
      await loop(id);
    },

    retry: async () => {
      const id = get().activeId;
      const c = id ? conv(id) : null;
      if (!c || get().runningId || c.messages[c.messages.length - 1]?.role !== "user") return;
      await loop(c.id);
    },

    stop: () => {
      stopRequested = true;
      if (currentRequest) void ipc.agentCancel(currentRequest).catch(() => undefined);
      for (const resolve of approvals.values()) resolve(false);
    },

    answer: (toolId, approved) => {
      approvals.get(toolId)?.(approved);
    },
  };
});

/** Opens rAImy Agent and sends `text` (in a new conversation when asked). */
export function askAgent(text: string, opts: { fresh?: boolean; send?: boolean } = {}): void {
  const agent = useAgent.getState();
  useDesktop.getState().openApp("agent");
  if (agent.runningId) {
    agent.setDraft(text);
    return;
  }
  if (opts.fresh) agent.newConversation();
  if (opts.send === false) agent.setDraft(text);
  else void agent.send(text);
}

/** The user's own words in a message (without the context block). */
export function visibleUserText(m: ApiMessage): string | null {
  if (m.role !== "user") return null;
  const texts = m.content.filter((p): p is UserText => p.type === "text" && !p.text.startsWith(`<${CONTEXT_TAG}>`));
  return texts.length ? texts.map((t) => t.text).join("\n") : null;
}
