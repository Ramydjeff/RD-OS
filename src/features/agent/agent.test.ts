import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { Markdown, parseMarkdown } from "@/components/apps/agent/Markdown";
import { parseDiagnostics } from "@/components/apps/studio/runner";
import { contentToEcho, TurnAccumulator, type ToolUseBlock } from "@/features/agent/accumulator";
import { SYSTEM_PROMPT, TOOLS } from "@/features/agent/definition";
import { runCommand, runLang, shQuote, fileKind, isEditable, formatSize } from "@/lib/fileTypes";
import { score } from "@/lib/fuzzy";

function feed(acc: TurnAccumulator, events: Record<string, unknown>[]) {
  for (const e of events) acc.handle(e);
}

describe("TurnAccumulator", () => {
  it("rebuilds thinking, text and tool calls from server-sent events", () => {
    const acc = new TurnAccumulator();
    feed(acc, [
      { type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 120 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Je regarde " } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "le fichier." } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig123" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Je lis " } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "main.c." } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path": "~/tp/' } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'main.c"}' } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } },
      { type: "message_stop" },
    ]);
    expect(acc.done).toBe(true);
    expect(acc.stopReason).toBe("tool_use");
    expect(acc.usage).toEqual({ input_tokens: 120, output_tokens: 42 });
    const [thinking, text, tool] = acc.content();
    expect(thinking).toEqual({ type: "thinking", thinking: "Je regarde le fichier.", signature: "sig123" });
    expect(text).toEqual({ type: "text", text: "Je lis main.c." });
    expect((tool as ToolUseBlock).input).toEqual({ path: "~/tp/main.c" });
    expect(acc.invalidInputs.size).toBe(0);
  });

  it("flags tool input that is not valid JSON instead of guessing", () => {
    const acc = new TurnAccumulator();
    feed(acc, [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "write_file", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path": "a.c", "content": "int' } },
      { type: "content_block_stop", index: 0 },
    ]);
    expect(acc.invalidInputs.get("t")).toContain('"content": "int');
  });

  it("treats an empty tool input as {}", () => {
    const acc = new TurnAccumulator();
    feed(acc, [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "get_environment", input: {} } },
      { type: "content_block_stop", index: 0 },
    ]);
    expect((acc.content()[0] as ToolUseBlock).input).toEqual({});
    expect(acc.invalidInputs.size).toBe(0);
  });
});

describe("contentToEcho", () => {
  it("drops fallback markers and the non-text blocks before the last switch", () => {
    const echoed = contentToEcho([
      { type: "thinking", thinking: "a", signature: "s" },
      { type: "text", text: "Début" },
      { type: "tool_use", id: "x", name: "read_file", input: {} },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "b", signature: "s2" },
      { type: "text", text: "Suite" },
      { type: "text", text: "" },
      { type: "mystery_block" },
    ]);
    expect(echoed.map((b) => b.type)).toEqual(["text", "thinking", "text"]);
  });

  it("keeps everything when there was no fallback", () => {
    const blocks = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "tool_use", id: "x", name: "read_file", input: { path: "a" } },
    ];
    expect(contentToEcho(blocks)).toEqual(blocks);
  });
});

describe("agent definition", () => {
  it("has stable, well-formed tools and a French system prompt", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(30);
    }
    expect(SYSTEM_PROMPT).toContain("rAImy");
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/); // nothing date-dependent in the cached prefix
  });
});

describe("file rules and run commands", () => {
  it("knows which files to edit and how to run them", () => {
    expect(fileKind("Makefile")).toBe("make");
    expect(isEditable("main.cpp")).toBe(true);
    expect(isEditable("setup.exe")).toBe(false);
    expect(runLang("tp.py")).toBe("python");
    expect(runLang("notes.md")).toBeNull();
  });

  it("builds safe compile-and-run commands", () => {
    expect(runCommand("main.c", "c")).toBe("gcc -Wall -Wextra -g -std=c17 main.c -o main -lm && ./main");
    expect(runCommand("hello.cpp", "cpp")).toBe("g++ -Wall -Wextra -g -std=c++20 hello.cpp -o hello && ./hello");
    expect(runCommand("mon tp.py", "python")).toBe("python3 'mon tp.py'");
    expect(shQuote("it's.c")).toBe(`'it'\\''s.c'`);
  });

  it("formats sizes in French units", () => {
    expect(formatSize(512)).toBe("512 o");
    expect(formatSize(2048)).toBe("2.0 Ko");
    expect(formatSize(5 * 1024 ** 3)).toBe("5.0 Go");
  });
});

describe("parseDiagnostics", () => {
  it("reads gcc errors and warnings for the file", () => {
    const out = [
      "main.c: In function 'main':",
      "main.c:5:5: error: 'x' undeclared (first use in this function)",
      "main.c:9:12: warning: unused variable 'y' [-Wunused-variable]",
      "other.c:3:1: error: not mine",
    ].join("\n");
    const d = parseDiagnostics(out, "main.c");
    expect(d.get(5)).toMatch(/^Erreur : 'x' undeclared/);
    expect(d.get(9)).toMatch(/^Avertissement/);
    expect(d.size).toBe(2);
  });

  it("reads Python tracebacks", () => {
    const out = ['Traceback (most recent call last):', '  File "/home/r/tp/main.py", line 3, in <module>', "    print(x)", "NameError: name 'x' is not defined"].join("\n");
    expect(parseDiagnostics(out, "main.py").get(3)).toBe("NameError: name 'x' is not defined");
  });
});

describe("markdown and search", () => {
  it("parses the blocks the agent writes", () => {
    const nodes = parseMarkdown("# Titre\n\nTexte **gras**.\n\n- un\n- deux\n\n```c\nint x;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```bash\nls");
    expect(nodes.map((n) => n.t)).toEqual(["h", "p", "ul", "code", "table", "code"]);
    const last = nodes[nodes.length - 1] as { t: "code"; open: boolean; code: string };
    expect(last.open).toBe(true);
    expect(last.code).toBe("ls");
    const table = nodes[4] as { t: "table"; rows: string[][] };
    expect(table.rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("matches accents and word starts", () => {
    expect(score("param", "Paramètres")).not.toBeNull();
    expect(score("studio", "Code Studio")).toBeGreaterThan(score("sdo", "Code Studio") ?? -1);
    expect(score("zzz", "Fichiers")).toBeNull();
  });
});

describe("Markdown rendering", () => {
  it("renders several bold spans in one paragraph without hanging", () => {
    const { container } = render(createElement(Markdown, { text: "Un **gras**, du `code` et **encore** du *texte*." }));
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.textContent).toContain("Un gras, du code et encore du texte.");
  });
});
