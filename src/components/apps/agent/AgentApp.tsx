// rAImy Agent: chat with Claude, which can read the student's files, write
// code and run commands in Ubuntu once the student approves each action.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  FolderTree,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeft,
  RotateCcw,
  Settings,
  ShieldAlert,
  Square,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { AgentSettings } from "@/components/apps/agent/AgentSettings";
import { Markdown } from "@/components/apps/agent/Markdown";
import { useWindow } from "@/components/desktop/windowContext";
import { RaimyIcon } from "@/components/ui/RaimyLogo";
import type { Block, ThinkingBlock, ToolUseBlock } from "@/features/agent/accumulator";
import { describeCall } from "@/features/agent/tools";
import { openInStudio } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { highlight, TOKEN_STYLE } from "@/lib/highlight";
import { languageFromFileName } from "@/lib/highlight";
import { useAgent, visibleUserText, type Conversation, type Note, type ToolState } from "@/store/agent";
import type { Location } from "@/types/ipc";

const SUGGESTIONS = [
  "Vérifie que mon environnement C, C++ et Python est bien installé dans Ubuntu",
  "Explique-moi les pointeurs en C avec un petit exemple",
  "Écris un programme C qui utilise fork() et explique la sortie",
  "Comment créer et utiliser un environnement virtuel Python ?",
];

const TOOL_ICONS: Record<string, React.ReactNode> = {
  run_command: <TerminalSquare size={14} />,
  read_file: <FileText size={14} />,
  list_directory: <FolderTree size={14} />,
  write_file: <Code2 size={14} />,
  open_in_code_studio: <Code2 size={14} />,
  get_environment: <Wrench size={14} />,
};

function Thinking({ block, live }: { block: ThinkingBlock; live: boolean }) {
  const [open, setOpen] = useState(false);
  const text = block.thinking.trim();
  if (!text && !live) return null;
  return (
    <div className="my-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[12px] text-muted hover:text-fg2">
        {live && !text ? <LoaderCircle size={12} className="animate-spin" /> : <Brain size={12} />}
        {live ? "Réflexion…" : "Réflexion"}
        {text && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </button>
      {open && text && <p className="selectable mt-1.5 border-l-2 border-line pl-3 text-[12.5px] italic leading-relaxed whitespace-pre-wrap text-muted">{text}</p>}
    </div>
  );
}

function OutputBox({ text, tone = "plain" }: { text: string; tone?: "plain" | "err" }) {
  if (!text.trim()) return null;
  return (
    <pre
      className={cn(
        "selectable max-h-64 overflow-auto rounded-lg bg-code px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap",
        tone === "err" ? "text-danger" : "text-fg2",
      )}
    >
      {text.trimEnd()}
    </pre>
  );
}

function CodePreview({ path, code }: { path: string; code: string }) {
  const lines = highlight(code, languageFromFileName(path));
  return (
    <pre className="selectable max-h-72 overflow-auto rounded-lg bg-code px-3 py-2 font-mono text-[11.5px] leading-[1.55]">
      {lines.map((toks, i) => (
        <div key={i} className="flex">
          <span className="w-8 shrink-0 pr-2 text-right text-faint select-none">{i + 1}</span>
          <span>{toks.length === 0 ? "​" : toks.map((t, j) => (t.c ? <span key={j} className={TOKEN_STYLE[t.c]}>{t.t}</span> : t.t))}</span>
        </div>
      ))}
    </pre>
  );
}

function ToolCard({ block, state, partial }: { block: ToolUseBlock; state: ToolState | undefined; partial?: string }) {
  const [open, setOpen] = useState(block.name === "write_file" || block.name === "run_command");
  const answer = useAgent((s) => s.answer);
  const input = block.input;
  const status = state?.status;
  const meta = state?.outcome?.meta ?? {};
  const exitCode = meta.exitCode as number | null | undefined;
  const streaming = partial !== undefined;

  const chip = streaming
    ? { label: "préparation…", cls: "text-muted" }
    : status === "awaiting"
      ? { label: "en attente de validation", cls: "text-warn" }
      : status === "running"
        ? { label: "en cours…", cls: "text-accent2" }
        : status === "refused"
          ? { label: "refusé", cls: "text-muted" }
          : status === "error"
            ? { label: "échec", cls: "text-danger" }
            : block.name === "run_command" && typeof exitCode === "number"
              ? { label: exitCode === 0 ? "code 0" : `code ${exitCode}`, cls: exitCode === 0 ? "text-ok" : "text-danger" }
              : status === "done"
                ? { label: "terminé", cls: "text-ok" }
                : { label: "", cls: "" };

  return (
    <div className={cn("my-2.5 overflow-hidden rounded-xl border bg-surface", status === "awaiting" ? "border-warn/60 shadow-[0_0_0_3px_rgb(245_181_68/0.12)]" : "border-line")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <span className="text-accent">{TOOL_ICONS[block.name] ?? <Wrench size={14} />}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{streaming ? "rAImy prépare une action…" : describeCall(block.name, input)}</span>
        {(status === "running" || streaming) && <LoaderCircle size={12} className="animate-spin text-muted" />}
        <span className={cn("text-[11px]", chip.cls)}>{chip.label}</span>
        {open ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {streaming && block.name === "write_file" && <p className="text-[11.5px] text-muted">{partial.length.toLocaleString("fr-FR")} caractères reçus…</p>}
          {block.name === "run_command" && typeof input.command === "string" && (
            <pre className="selectable overflow-x-auto rounded-lg bg-code px-3 py-2 font-mono text-[12px] text-fg">
              <span className="text-accent select-none">$ </span>
              {input.command}
              {typeof input.cwd === "string" && <span className="block text-[10.5px] text-faint">dans {input.cwd}</span>}
            </pre>
          )}
          {block.name === "write_file" && typeof input.content === "string" && typeof input.path === "string" && (
            <CodePreview path={input.path} code={input.content} />
          )}
          {status === "awaiting" && (
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                autoFocus
                onClick={() => answer(block.id, true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-onaccent hover:bg-accent-hover"
              >
                <Zap size={12} /> {block.name === "write_file" ? "Écrire le fichier" : "Exécuter"}
              </button>
              <button type="button" onClick={() => answer(block.id, false)} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg2 hover:bg-hover">
                Refuser
              </button>
              <span className="text-[11px] text-muted">Vérifiez l'action avant de l'autoriser.</span>
            </div>
          )}
          {block.name === "run_command" && state?.outcome && (
            <>
              <OutputBox text={(meta.stdout as string) ?? ""} />
              <OutputBox text={(meta.stderr as string) ?? ""} tone="err" />
              {!meta.stdout && !meta.stderr && <p className="text-[11.5px] text-muted">{state.outcome.content}</p>}
            </>
          )}
          {block.name === "write_file" && status === "done" && meta.location ? (
            <button
              type="button"
              onClick={() => void openInStudio(meta.location as Location)}
              className="flex items-center gap-1.5 text-[12px] text-accent2 hover:underline"
            >
              <Code2 size={12} /> Ouvrir dans Code Studio
            </button>
          ) : null}
          {(block.name === "read_file" || block.name === "list_directory" || block.name === "get_environment" || block.name === "open_in_code_studio" || status === "error") &&
            state?.outcome && block.name !== "run_command" && <OutputBox text={state.outcome.content} tone={status === "error" ? "err" : "plain"} />}
        </div>
      )}
    </div>
  );
}

function NoteView({ note }: { note: Note }) {
  const retry = useAgent((s) => s.retry);
  if (note.kind === "interrupted") {
    return (
      <div className="my-2">
        {note.text && <Markdown text={note.text} />}
        <p className="text-[11.5px] text-muted italic">— Réponse interrompue.</p>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "my-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px]",
        note.kind === "error" ? "border-danger/40 bg-danger/8 text-fg" : note.kind === "refusal" ? "border-warn/40 bg-warn/8 text-fg" : "border-line bg-surface text-fg2",
      )}
    >
      <ShieldAlert size={15} className={cn("mt-0.5 shrink-0", note.kind === "error" ? "text-danger" : "text-warn")} />
      <span className="flex-1">{note.text}</span>
      {note.kind === "error" && (
        <button type="button" onClick={() => void retry()} className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11.5px] hover:bg-hover">
          <RotateCcw size={11} /> Réessayer
        </button>
      )}
    </div>
  );
}

function AssistantBlocks({ blocks, conv, live, partial }: { blocks: Block[]; conv: Conversation; live: boolean; partial?: Record<string, string> }) {
  const lastText = live ? blocks.map((b) => b.type).lastIndexOf("text") : -1;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "thinking") return <Thinking key={i} block={b as ThinkingBlock} live={live && i === blocks.length - 1} />;
        if (b.type === "text") return <Markdown key={i} text={(b as { text: string }).text} streaming={live && i === lastText} />;
        if (b.type === "tool_use") {
          const tb = b as ToolUseBlock;
          return <ToolCard key={tb.id} block={tb} state={conv.tools[tb.id]} partial={live ? partial?.[tb.id] : undefined} />;
        }
        return null;
      })}
    </>
  );
}

function Transcript({ conv }: { conv: Conversation }) {
  const live = useAgent((s) => (s.live?.convId === conv.id ? s.live : null));
  const running = useAgent((s) => s.runningId === conv.id);
  const notesAt = useMemo(() => {
    const m = new Map<number, Note[]>();
    for (const n of conv.notes) m.set(n.afterIndex, [...(m.get(n.afterIndex) ?? []), n]);
    return m;
  }, [conv.notes]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-5">
      {notesAt.get(-1)?.map((n, j) => <NoteView key={`n-1-${j}`} note={n} />)}
      {conv.messages.map((m, i) => {
        const notes = notesAt.get(i)?.map((n, j) => <NoteView key={`n${i}-${j}`} note={n} />);
        if (m.role === "user") {
          const text = visibleUserText(m);
          return (
            <div key={i}>
              {text && (
                <div className="my-4 flex justify-end">
                  <div className="selectable max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg">
                    {text.length > 1800 ? `${text.slice(0, 1800)}…` : text}
                  </div>
                </div>
              )}
              {notes}
            </div>
          );
        }
        return (
          <div key={i} className="my-1">
            <AssistantBlocks blocks={m.content} conv={conv} live={false} />
            {notes}
          </div>
        );
      })}
      {live && <AssistantBlocks blocks={live.blocks} conv={conv} live partial={live.partial} />}
      {running && (!live || live.blocks.length === 0) && (
        <p className="my-3 flex items-center gap-2 text-[12.5px] text-muted">
          <LoaderCircle size={13} className="animate-spin text-accent" /> rAImy réfléchit…
        </p>
      )}
    </div>
  );
}

export default function AgentApp() {
  const { focused } = useWindow();
  const status = useAgent((s) => s.status);
  const conversations = useAgent((s) => s.conversations);
  const activeId = useAgent((s) => s.activeId);
  const runningId = useAgent((s) => s.runningId);
  const draft = useAgent((s) => s.draft);
  const live = useAgent((s) => s.live);
  const [showList, setShowList] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const conv = conversations.find((c) => c.id === activeId) ?? null;
  const busy = runningId !== null;

  useEffect(() => {
    if (!status) void useAgent.getState().loadStatus();
  }, [status]);
  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused, activeId]);

  // Follow the answer while it streams, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [conv?.messages.length, conv?.notes.length, conv?.tools, live]);

  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(220, ta.scrollHeight)}px`;
  }, [draft]);

  function send(text = draft) {
    if (!text.trim() || busy) return;
    stick.current = true;
    void useAgent.getState().send(text);
  }

  const needsKey = status !== null && !status.hasKey;
  const empty = !conv || conv.messages.length === 0;
  const modelLabel = status?.models.find((m) => m.id === status.model)?.label ?? "Claude";

  return (
    <div className="flex h-full">
      {showList && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
          <div className="p-2">
            <button
              type="button"
              onClick={() => useAgent.getState().newConversation()}
              className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px] text-fg hover:bg-hover"
            >
              <MessageSquarePlus size={14} /> Nouvelle conversation
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {conversations
              .filter((c) => c.messages.length > 0)
              .map((c) => (
                <div
                  key={c.id}
                  className={cn("group flex items-center gap-1 rounded-lg px-2.5 py-2 text-[12.5px]", c.id === activeId ? "bg-active text-fg" : "text-fg2 hover:bg-hover")}
                  onClick={() => useAgent.getState().select(c.id)}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title || "Conversation"}</span>
                  {runningId === c.id ? (
                    <LoaderCircle size={12} className="animate-spin text-accent" />
                  ) : (
                    <button
                      type="button"
                      aria-label="Supprimer"
                      onClick={(e) => {
                        e.stopPropagation();
                        useAgent.getState().remove(c.id);
                      }}
                      className="hidden text-muted hover:text-danger group-hover:block"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <button type="button" title="Conversations" onClick={() => setShowList((s) => !s)} className={cn("rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg", showList && "bg-active text-fg")}>
            <PanelLeft size={15} />
          </button>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg2">{conv?.title || "Nouvelle conversation"}</span>
          {conv && conv.messages.length > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted" title="Exécuter les commandes et écrire les fichiers sans demander, pour cette conversation">
              <input
                type="checkbox"
                checked={conv.autoApprove}
                onChange={(e) => useAgent.getState().setAutoApprove(conv.id, e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Mode autonome
            </label>
          )}
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-muted">{modelLabel}</span>
          <button type="button" title="Nouvelle conversation" onClick={() => useAgent.getState().newConversation()} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg">
            <MessageSquarePlus size={15} />
          </button>
          <button type="button" title="Réglages de l'agent" onClick={() => setShowSettings((s) => !s)} className={cn("rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg", showSettings && "bg-active text-fg")}>
            <Settings size={15} />
          </button>
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {showSettings || needsKey ? (
            <div className="mx-auto max-w-2xl px-6 py-6">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RaimyIcon size={32} />
                  <div>
                    <h2 className="font-display text-[18px] font-semibold text-fg">{needsKey ? "Activer rAImy Agent" : "Réglages de rAImy Agent"}</h2>
                    <p className="text-[12px] text-muted">Propulsé par Claude, d'Anthropic.</p>
                  </div>
                </div>
                {showSettings && !needsKey && (
                  <button type="button" aria-label="Fermer" onClick={() => setShowSettings(false)} className="rounded-md p-1.5 text-muted hover:bg-hover">
                    <X size={15} />
                  </button>
                )}
              </div>
              <AgentSettings onDone={() => setShowSettings(false)} />
            </div>
          ) : empty ? (
            <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
              <span className="relative">
                <span className="absolute inset-0 -z-10 rounded-full bg-accent/25 blur-2xl" />
                <RaimyIcon size={54} />
              </span>
              <h2 className="mt-5 font-display text-[22px] font-semibold text-fg">Bonjour, je suis rAImy.</h2>
              <p className="mt-1.5 max-w-md text-[13px] text-muted">
                Je lis vos fichiers, j'explique, j'écris du code et je lance des commandes dans Ubuntu — toujours avec votre accord.
              </p>
              <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-xl border border-line bg-surface px-3.5 py-3 text-left text-[12.5px] text-fg2 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/50 hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            conv && <Transcript conv={conv} />
          )}
        </div>

        {!needsKey && !showSettings && (
          <div className="shrink-0 px-4 pt-1 pb-3">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[0_8px_30px_-16px_rgb(0_0_0/0.6)] focus-within:border-accent/50">
                <Bot size={16} className="mb-2 ml-1.5 shrink-0 text-accent" />
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => useAgent.getState().setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={busy ? "rAImy travaille… (vous pouvez préparer le message suivant)" : "Posez une question, collez une erreur, demandez du code…"}
                  className="max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13.5px] text-fg outline-none placeholder:text-faint"
                />
                {busy ? (
                  <button
                    type="button"
                    title="Arrêter"
                    onClick={() => useAgent.getState().stop()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-fg hover:bg-hover"
                  >
                    <Square size={13} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    title="Envoyer (Entrée)"
                    disabled={!draft.trim()}
                    onClick={() => send()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-onaccent transition-[background-color,transform] hover:bg-accent-hover active:scale-90 disabled:opacity-30"
                  >
                    <ArrowUp size={16} />
                  </button>
                )}
              </div>
              <p className="mt-1.5 flex justify-between px-1 text-[10.5px] text-faint">
                <span>Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne</span>
                {conv && conv.usage.output > 0 && (
                  <span className="font-mono">
                    {(conv.usage.input + conv.usage.cached).toLocaleString("fr-FR")} tokens lus · {conv.usage.output.toLocaleString("fr-FR")} écrits
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
