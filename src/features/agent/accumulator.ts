// Rebuilds an assistant message from the Messages API's server-sent events.
// The blocks it produces are appended to the conversation verbatim (thinking
// text and signatures included), as the API requires for tool loops.

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}
export interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface OtherBlock {
  type: string;
  [k: string]: unknown;
}
export type Block = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock | OtherBlock;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

type Ev = Record<string, unknown> & { type?: string };

export class TurnAccumulator {
  blocks: Block[] = [];
  /** Raw JSON fragments of tool inputs, by block index. */
  private partial = new Map<number, string>();
  /** Tool blocks whose input was not valid JSON when the block ended. */
  invalidInputs = new Map<string, string>();
  stopReason: string | null = null;
  stopDetails: Record<string, unknown> | null = null;
  model: string | null = null;
  usage: Usage = {};
  done = false;

  handle(ev: Ev): void {
    switch (ev.type) {
      case "message_start": {
        const m = ev.message as { model?: string; usage?: Usage } | undefined;
        this.model = m?.model ?? null;
        this.usage = { ...(m?.usage ?? {}) };
        break;
      }
      case "content_block_start": {
        const i = ev.index as number;
        const b = structuredClone(ev.content_block as Block);
        if (b.type === "text") (b as TextBlock).text ??= "";
        if (b.type === "thinking") (b as ThinkingBlock).thinking ??= "";
        if (b.type === "tool_use") {
          (b as ToolUseBlock).input = {};
          this.partial.set(i, "");
        }
        this.blocks[i] = b;
        break;
      }
      case "content_block_delta": {
        const i = ev.index as number;
        const b = this.blocks[i];
        const d = ev.delta as Record<string, string> | undefined;
        if (!b || !d) break;
        if (d.type === "text_delta" && b.type === "text") (b as TextBlock).text += d.text ?? "";
        else if (d.type === "thinking_delta" && b.type === "thinking") (b as ThinkingBlock).thinking += d.thinking ?? "";
        else if (d.type === "signature_delta" && b.type === "thinking")
          (b as ThinkingBlock).signature = ((b as ThinkingBlock).signature ?? "") + (d.signature ?? "");
        else if (d.type === "input_json_delta") this.partial.set(i, (this.partial.get(i) ?? "") + (d.partial_json ?? ""));
        break;
      }
      case "content_block_stop": {
        const i = ev.index as number;
        const b = this.blocks[i];
        if (b?.type === "tool_use") {
          const raw = this.partial.get(i) ?? "";
          const tb = b as ToolUseBlock;
          try {
            const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) tb.input = parsed as Record<string, unknown>;
            else this.invalidInputs.set(tb.id, raw);
          } catch {
            this.invalidInputs.set(tb.id, raw);
          }
          this.partial.delete(i);
        }
        break;
      }
      case "message_delta": {
        const d = ev.delta as { stop_reason?: string; stop_details?: Record<string, unknown> } | undefined;
        if (d?.stop_reason) this.stopReason = d.stop_reason;
        if (d?.stop_details) this.stopDetails = d.stop_details;
        const u = ev.usage as Usage | undefined;
        if (u) this.usage = { ...this.usage, ...u };
        break;
      }
      case "message_stop":
        this.done = true;
        break;
    }
  }

  /** Raw tool input received so far (for live previews of long tool inputs). */
  partialInput(index: number): string | undefined {
    return this.partial.get(index);
  }

  /** Blocks in order, without holes. */
  content(): Block[] {
    return this.blocks.filter(Boolean);
  }
}

const KNOWN = new Set(["text", "thinking", "redacted_thinking", "tool_use"]);

/**
 * The assistant content to send back on the next request. After a refusal
 * fallback, blocks that preceded the switch (other than text) are dropped, and
 * the fallback markers and any unrecognised block types are never echoed.
 */
export function contentToEcho(blocks: Block[]): Block[] {
  let lastFallback = -1;
  blocks.forEach((b, i) => {
    if (b.type === "fallback") lastFallback = i;
  });
  return blocks.filter((b, i) => {
    if (!KNOWN.has(b.type)) return false;
    if (i < lastFallback && b.type !== "text") return false;
    if (b.type === "text" && !(b as TextBlock).text) return false;
    return true;
  });
}
