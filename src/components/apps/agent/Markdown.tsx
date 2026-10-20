// A small Markdown renderer for agent answers: headings, lists, quotes,
// tables, inline code and links, and code blocks with Copy, Run in terminal
// and Open in Code Studio. Unfinished blocks render fine while streaming.

import { memo, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Code2, Copy, Play } from "lucide-react";
import { runInTerminal } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { highlight, TOKEN_STYLE, type Lang } from "@/lib/highlight";
import { useDesktop } from "@/store/desktop";
import { useStudio } from "@/store/studio";

const LANG_ALIASES: Record<string, Lang> = {
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  py: "python",
  python: "python",
  python3: "python",
  sh: "shell",
  bash: "shell",
  shell: "shell",
  zsh: "shell",
  console: "shell",
  js: "js",
  javascript: "js",
  ts: "ts",
  typescript: "ts",
  json: "json",
  md: "markdown",
  markdown: "markdown",
};

const STUDIO_NAMES: Partial<Record<Lang, string>> = { c: "main.c", cpp: "main.cpp", python: "main.py", shell: "script.sh" };

function CodeBlock({ lang, code, streaming }: { lang: string; code: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const l: Lang = LANG_ALIASES[lang.toLowerCase()] ?? "plain";
  const lines = highlight(code, l);
  const runnable = l === "shell" && !streaming && code.trim().length > 0;
  const studioName = STUDIO_NAMES[l];
  // A shell block of "$ cmd" lines runs the commands, not the prompts.
  const command = code
    .split("\n")
    .map((x) => x.replace(/^\$\s+/, ""))
    .join("\n")
    .trim();

  return (
    <div className="group my-3 overflow-hidden rounded-xl border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line bg-surface/70 px-3 py-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{lang || "texte"}</span>
        <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          {runnable && (
            <BlockButton label="Exécuter dans le terminal" onClick={() => void runInTerminal(command)}>
              <Play size={12} /> Exécuter
            </BlockButton>
          )}
          {studioName && !streaming && (
            <BlockButton
              label="Ouvrir dans Code Studio"
              onClick={() => {
                useStudio.getState().newFromText(studioName, code.endsWith("\n") ? code : `${code}\n`);
                useDesktop.getState().openApp("studio");
              }}
            >
              <Code2 size={12} /> Code Studio
            </BlockButton>
          )}
          <BlockButton
            label="Copier"
            onClick={() =>
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              })
            }
          >
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {copied ? "Copié" : "Copier"}
          </BlockButton>
        </div>
      </div>
      <pre className="selectable overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6]">
        {lines.map((toks, i) => (
          <div key={i}>
            {toks.length === 0 ? "​" : toks.map((t, j) => (t.c ? <span key={j} className={TOKEN_STYLE[t.c]}>{t.t}</span> : t.t))}
          </div>
        ))}
      </pre>
    </div>
  );
}

function BlockButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} onClick={onClick} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-fg2 hover:bg-hover hover:text-fg">
      {children}
    </button>
  );
}

// ─── Inline ─────────────────────────────────────────────────────────────────

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  // A fresh regex per call: bold text recurses, and a shared /g regex would lose its place.
  const re = new RegExp(INLINE.source, "g");
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k} className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[0.88em] text-fg">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k} className="font-semibold text-fg">{inline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) {
      const label = m[4].slice(1, m[4].indexOf("]"));
      const url = m[5]!;
      out.push(<Link key={k} url={url}>{label}</Link>);
    } else if (m[6]) out.push(<Link key={k} url={m[6]}>{m[6]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Link({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(url).catch(() => window.open(url, "_blank"));
      }}
      className="text-accent2 underline decoration-accent2/40 underline-offset-2 hover:decoration-accent2"
    >
      {children}
    </a>
  );
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

type Node =
  | { t: "code"; lang: string; code: string; open: boolean }
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "table"; rows: string[][] }
  | { t: "hr" };

export function parseMarkdown(src: string): Node[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const nodes: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      const open = i >= lines.length;
      i++;
      nodes.push({ t: "code", lang: fence[1] ?? "", code: body.join("\n"), open });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      nodes.push({ t: "h", level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      nodes.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      nodes.push({ t: "table", rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      nodes.push({ t: "quote", text: body.join(" ") });
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const num = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || num.test(line)) {
      const ordered = num.test(line);
      const re = ordered ? num : bullet;
      const items: string[] = [];
      while (i < lines.length && (re.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length))) {
        const l = lines[i]!;
        if (re.test(l)) items.push(l.replace(re, ""));
        else items[items.length - 1] += ` ${l.trim()}`;
        i++;
      }
      nodes.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|#{1,4}\s|>|\||[-*+]\s|\d+[.)]\s)/.test(lines[i]!)) para.push(lines[i++]!);
    if (para.length === 0) para.push(lines[i++]!);
    nodes.push({ t: "p", text: para.join("\n") });
  }
  return nodes;
}

export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const nodes = parseMarkdown(text);
  return (
    <div className="selectable text-[13.5px] leading-[1.65] text-fg2">
      {nodes.map((n, i) => {
        const k = String(i);
        switch (n.t) {
          case "code":
            return <CodeBlock key={k} lang={n.lang} code={n.code} streaming={streaming && n.open} />;
          case "h":
            return (
              <p key={k} className={cn("mt-4 mb-1.5 font-display font-semibold text-fg", n.level <= 2 ? "text-[16px]" : "text-[14px]")}>
                {inline(n.text, k)}
              </p>
            );
          case "ul":
          case "ol": {
            const Tag = n.t;
            return (
              <Tag key={k} className={cn("my-2 space-y-1 pl-5", n.t === "ul" ? "list-disc marker:text-accent" : "list-decimal marker:text-muted")}>
                {n.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={k} className="my-2 border-l-2 border-accent/60 pl-3 text-muted">
                {inline(n.text, k)}
              </blockquote>
            );
          case "table":
            return (
              <div key={k} className="my-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {n.rows.map((r, j) => (
                      <tr key={j} className={cn("border-b border-line last:border-0", j === 0 && "bg-surface font-semibold text-fg")}>
                        {r.map((c, x) => (
                          <td key={x} className="px-3 py-1.5">
                            {inline(c, `${k}-${j}-${x}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={k} className="my-4 border-line" />;
          default:
            return (
              <p key={k} className="my-2 whitespace-pre-wrap">
                {inline(n.text, k)}
              </p>
            );
        }
      })}
      {streaming && <span aria-hidden className="caret" />}
    </div>
  );
});
