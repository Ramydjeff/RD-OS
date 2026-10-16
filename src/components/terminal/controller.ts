// One TerminalController owns one xterm.js instance and (at any time) one
// backend PTY session. It lives outside React so layout changes, tab switches
// and splits never destroy a running terminal; React only re-parents its element.

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { openUrl } from "@tauri-apps/plugin-opener";

import { errorMessage } from "@/lib/errors";
import { Channel, ipc, type TerminalChannelMessage } from "@/lib/ipc";
import { terminalTheme, type ResolvedTheme } from "@/lib/terminalTheme";
import type { Location, Settings } from "@/types/ipc";

export type SessionState = "starting" | "running" | "exited" | "failed";

export interface ControllerHooks {
  /** Called on every state or metadata change. */
  onChange: (patch: Partial<ControllerMeta>) => void;
  getSettings: () => Settings;
  getTheme: () => ResolvedTheme;
  /** Asks the user before a multi-line paste lands in a shell without bracketed paste. */
  confirmPaste: (text: string) => Promise<boolean>;
  /** Called for key combinations that belong to the app, not the shell. Return true when handled. */
  onAppKey: (e: KeyboardEvent) => boolean;
  /** Pane gained focus. */
  onFocus: () => void;
  onSearchRequested: () => void;
}

export interface ControllerMeta {
  state: SessionState;
  exitCode: number | null;
  backendId: string | null;
  title: string;
  cwdHint: string | null;
  startedAt: number | null;
  error: string | null;
  distro: string | null;
}

const ACK_BATCH = 64 * 1024;
const ACK_DELAY_MS = 30;
const INPUT_CHUNK = 256 * 1024;

const SEARCH_DECORATIONS: ISearchOptions["decorations"] = {
  matchBackground: "rgba(214, 48, 58, 0.35)",
  matchBorder: "#D6303A",
  matchOverviewRuler: "#D6303A",
  activeMatchBackground: "#D6303A",
  activeMatchBorder: "#D6E7F3",
  activeMatchColorOverviewRuler: "#D6E7F3",
};

function toBytes(msg: TerminalChannelMessage): Uint8Array | null {
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  if (ArrayBuffer.isView(msg)) return new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
  if (Array.isArray(msg)) return Uint8Array.from(msg);
  return null;
}

export class TerminalController {
  readonly element: HTMLDivElement;
  readonly term: Terminal;

  private readonly fitAddon = new FitAddon();
  private readonly searchAddon = new SearchAddon();
  private webgl: WebglAddon | null = null;
  private opened = false;
  private visible = false;
  private disposed = false;
  private starting = false;

  private backendId: string | null = null;

  private unacked = 0;
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  private inputQueue = "";
  private flushing = false;
  private lastCols = 0;
  private lastRows = 0;
  private startedAt = 0;
  private receivedOutput = false;
  private searchOptions: ISearchOptions = { caseSensitive: false, regex: false, wholeWord: false };

  meta: ControllerMeta = {
    state: "starting",
    exitCode: null,
    backendId: null,
    title: "",
    cwdHint: null,
    startedAt: null,
    error: null,
    distro: null,
  };

  constructor(
    readonly id: string,
    private readonly target: { distro: string | null; cwd: Location | null },
    private readonly hooks: ControllerHooks,
  ) {
    const s = hooks.getSettings().terminal;
    this.element = document.createElement("div");
    this.element.className = "h-full w-full";
    this.element.dataset.terminalId = id;
    this.term = new Terminal({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
      theme: terminalTheme(hooks.getTheme()),
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: false,
      rightClickSelectsWord: false,
      // ConPTY reflows output itself on modern Windows builds.
      windowsPty: { backend: "conpty", buildNumber: 22631 },
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = "11";
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => {
        // Output is untrusted: only open web links, and only on Ctrl+click.
        if (!(event.ctrlKey || event.metaKey)) return;
        if (!/^https?:\/\//i.test(uri)) return;
        void openUrl(uri).catch((e) => void ipc.log("warn", "terminal", `could not open link: ${errorMessage(e)}`));
      }),
    );

    this.term.onData((data) => this.send(data));
    this.term.onBinary((data) => {
      const id = this.backendId;
      if (!id || this.meta.state !== "running") return;
      const bytes = Array.from(data, (c) => c.charCodeAt(0) & 0xff);
      void ipc.terminalWriteBytes(id, bytes).catch(() => undefined);
    });
    this.term.onResize(({ cols, rows }) => this.pushSize(cols, rows));
    this.term.onTitleChange((title) => this.patch({ title }));
    this.term.onSelectionChange(() => {
      if (this.hooks.getSettings().terminal.copyOnSelect && this.term.hasSelection()) void this.copySelection(false);
    });
    this.term.parser.registerOscHandler(7, (data) => {
      // OSC 7 (file://host/path) is emitted by shells configured for it.
      const m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
      if (m?.[1]) {
        try {
          this.patch({ cwdHint: decodeURIComponent(m[1]) });
        } catch {
          /* ignore malformed paths */
        }
      }
      return true;
    });
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));

    this.element.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.term.hasSelection()) void this.copySelection(true);
      else void this.paste();
    });
    this.element.addEventListener("focusin", () => this.hooks.onFocus());
    this.element.addEventListener("mousedown", () => this.hooks.onFocus());
  }

  // ---- lifecycle ---------------------------------------------------------

  /** Attaches the terminal to `host` and starts the session on first use. */
  mount(host: HTMLElement): void {
    if (this.disposed) return;
    if (this.element.parentElement !== host) host.appendChild(this.element);
    if (!this.opened) {
      this.term.open(this.element);
      this.opened = true;
      void document.fonts?.ready.then(() => this.fit());
    }
    this.fit();
    if (this.meta.backendId === null && !this.starting && this.meta.state === "starting") void this.start();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!this.opened) return;
    if (visible) {
      this.enableWebgl();
      requestAnimationFrame(() => {
        this.fit();
        this.term.refresh(0, this.term.rows - 1);
      });
    } else {
      this.disableWebgl();
    }
  }

  private enableWebgl(): void {
    if (this.webgl || this.disposed) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => this.disableWebgl());
      this.term.loadAddon(addon);
      this.webgl = addon;
    } catch {
      this.webgl = null; // falls back to the DOM renderer
    }
  }

  private disableWebgl(): void {
    try {
      this.webgl?.dispose();
    } catch {
      /* already gone */
    }
    this.webgl = null;
  }

  fit(): void {
    if (!this.opened || this.disposed) return;
    const host = this.element.parentElement;
    if (!host || host.clientWidth < 20 || host.clientHeight < 20) return;
    try {
      this.fitAddon.fit();
    } catch {
      /* terminal not measurable yet */
    }
  }

  private patch(p: Partial<ControllerMeta>): void {
    this.meta = { ...this.meta, ...p };
    this.hooks.onChange(p);
  }

  async start(): Promise<void> {
    if (this.starting || this.disposed) return;
    this.starting = true;
    const id = crypto.randomUUID();
    this.backendId = id;
    this.receivedOutput = false;
    this.unacked = 0;
    this.startedAt = Date.now();
    this.patch({ state: "starting", exitCode: null, error: null, backendId: id, startedAt: this.startedAt, distro: this.target.distro });

    const channel = new Channel<TerminalChannelMessage>();
    channel.onmessage = (msg) => this.onMessage(id, msg);
    const cols = this.term.cols > 1 ? this.term.cols : 80;
    const rows = this.term.rows > 1 ? this.term.rows : 24;
    try {
      const summary = await ipc.terminalOpen(
        { sessionId: id, distro: this.target.distro, cwd: this.target.cwd, cols, rows },
        channel,
      );
      if (this.disposed || this.backendId !== id) {
        void ipc.terminalClose(id).catch(() => undefined);
        return;
      }
      this.lastCols = cols;
      this.lastRows = rows;
      this.patch({ state: "running", distro: summary.distro });
      // The pane may have been resized while the session was starting.
      this.pushSize(this.term.cols, this.term.rows);
    } catch (e) {
      const message = errorMessage(e);
      this.writeBanner(`\x1b[31mCould not start the terminal.\x1b[0m\r\n${message}\r\n`);
      this.patch({ state: "failed", error: message });
      this.backendId = null;
    } finally {
      this.starting = false;
    }
  }

  private onMessage(id: string, msg: TerminalChannelMessage): void {
    if (this.disposed || id !== this.backendId) return;
    const bytes = toBytes(msg);
    if (bytes) {
      this.receivedOutput = true;
      const n = bytes.length;
      this.term.write(bytes, () => this.queueAck(id, n));
      return;
    }
    if (typeof msg === "object" && msg !== null && "type" in msg && msg.type === "exit") {
      this.onExit(id, msg.code);
    }
  }

  private onExit(id: string, code: number | null): void {
    if (this.backendId !== id) return;
    const quick = Date.now() - this.startedAt < 4000;
    if (code !== null && code !== 0 && quick && !this.receivedOutput) {
      this.writeBanner(
        "\x1b[31mThe session ended immediately.\x1b[0m\r\n" +
          "Check that the distribution exists and that the starting directory is valid.\r\n",
      );
    }
    this.writeBanner(
      `\r\n\x1b[2m[Session ended${code === null ? "" : ` with exit code ${code}`}. Press Enter or use Restart to start a new shell.]\x1b[0m\r\n`,
    );
    // The backend released the PTY already; drop our handle to it.
    const closing = this.backendId;
    this.backendId = null;
    this.patch({ state: "exited", exitCode: code, backendId: null });
    if (closing) void ipc.terminalClose(closing).catch(() => undefined);
  }

  private writeBanner(text: string): void {
    this.term.write(text);
  }

  // ---- input -------------------------------------------------------------

  private send(data: string): void {
    if (this.meta.state === "exited" || this.meta.state === "failed") {
      if (data === "\r") void this.restart();
      return;
    }
    if (this.meta.state !== "running" || !this.backendId) return;
    this.inputQueue += data;
    if (!this.flushing) void this.flushInput();
  }

  /** Sends queued input strictly in order, one IPC call at a time. */
  private async flushInput(): Promise<void> {
    this.flushing = true;
    try {
      while (this.inputQueue.length > 0 && this.backendId) {
        let n = Math.min(INPUT_CHUNK, this.inputQueue.length);
        const last = this.inputQueue.charCodeAt(n - 1);
        if (n < this.inputQueue.length && last >= 0xd800 && last <= 0xdbff) n -= 1; // keep surrogate pairs whole
        const chunk = this.inputQueue.slice(0, n);
        this.inputQueue = this.inputQueue.slice(n);
        await ipc.terminalWrite(this.backendId, chunk);
      }
    } catch (e) {
      this.inputQueue = "";
      this.writeBanner(`\r\n\x1b[31m[input error: ${errorMessage(e)}]\x1b[0m\r\n`);
    } finally {
      this.flushing = false;
    }
  }

  private queueAck(id: string, n: number): void {
    if (id !== this.backendId) return;
    this.unacked += n;
    if (this.unacked >= ACK_BATCH) {
      this.flushAck(id);
    } else if (!this.ackTimer) {
      this.ackTimer = setTimeout(() => this.flushAck(id), ACK_DELAY_MS);
    }
  }

  private flushAck(id: string): void {
    clearTimeout(this.ackTimer);
    this.ackTimer = undefined;
    const n = this.unacked;
    this.unacked = 0;
    if (n > 0) void ipc.terminalAck(id, n).catch(() => undefined);
  }

  private pushSize(cols: number, rows: number): void {
    if (!this.backendId || this.meta.state !== "running") return;
    if (cols === this.lastCols && rows === this.lastRows) return;
    this.lastCols = cols;
    this.lastRows = rows;
    void ipc.terminalResize(this.backendId, cols, rows).catch(() => undefined);
  }

  /** Inserts text at the prompt without executing it (bracketed paste when supported). */
  insertText(text: string): void {
    if (this.meta.state !== "running") return;
    this.term.paste(text);
    this.term.focus();
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== "keydown") return true;
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    // Clipboard shortcuts (Windows Terminal conventions).
    if (ctrl && e.shiftKey && e.code === "KeyC") {
      void this.copySelection(true);
      return false;
    }
    if (ctrl && e.code === "KeyC" && !e.shiftKey && this.term.hasSelection()) {
      void this.copySelection(true); // Ctrl+C copies only while text is selected; otherwise it is SIGINT
      return false;
    }
    if (ctrl && e.code === "KeyV") {
      void this.paste();
      return false;
    }
    if (e.shiftKey && !e.ctrlKey && e.code === "Insert") {
      void this.paste();
      return false;
    }
    if (ctrl && !e.shiftKey && e.code === "Insert") {
      void this.copySelection(true);
      return false;
    }
    // App-level shortcuts are handled here only when they include Shift or Alt
    // (see lib/shortcuts.ts); plain Ctrl combinations always reach the shell.
    if (this.hooks.onAppKey(e)) return false;
    return true;
  }

  async copySelection(clear: boolean): Promise<void> {
    const text = this.term.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (clear) this.term.clearSelection();
    } catch (e) {
      void ipc.log("warn", "terminal", `copy failed: ${errorMessage(e)}`);
    }
  }

  async paste(): Promise<void> {
    if (this.meta.state !== "running") return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      void ipc.log("warn", "terminal", `clipboard read failed: ${errorMessage(e)}`);
      return;
    }
    if (!text) return;
    const normalized = text.replace(/\r\n/g, "\n");
    if (normalized.includes("\n") && !this.term.modes.bracketedPasteMode) {
      // The shell would execute each line as it arrives. Make the user look first.
      if (!(await this.hooks.confirmPaste(normalized))) return;
    }
    this.term.paste(normalized);
  }

  // ---- commands ----------------------------------------------------------

  focus(): void {
    this.term.focus();
  }

  clear(): void {
    this.term.clear();
  }

  selectAll(): void {
    this.term.selectAll();
  }

  searchNext(query: string): boolean {
    if (!query) {
      this.searchAddon.clearDecorations();
      return false;
    }
    return this.searchAddon.findNext(query, { ...this.searchOptions, decorations: SEARCH_DECORATIONS });
  }

  searchPrevious(query: string): boolean {
    if (!query) return false;
    return this.searchAddon.findPrevious(query, { ...this.searchOptions, decorations: SEARCH_DECORATIONS });
  }

  setSearchOptions(o: Partial<Pick<ISearchOptions, "caseSensitive" | "regex" | "wholeWord">>): void {
    this.searchOptions = { ...this.searchOptions, ...o };
  }

  clearSearch(): void {
    this.searchAddon.clearDecorations();
    this.term.clearSelection();
  }

  onSearchResults(cb: (r: { resultIndex: number; resultCount: number }) => void): { dispose(): void } {
    return this.searchAddon.onDidChangeResults(cb);
  }

  applySettings(s: Settings): void {
    const t = s.terminal;
    const o = this.term.options;
    o.fontFamily = t.fontFamily;
    o.fontSize = t.fontSize;
    o.lineHeight = t.lineHeight;
    o.cursorStyle = t.cursorStyle;
    o.cursorBlink = t.cursorBlink;
    o.scrollback = t.scrollback;
    requestAnimationFrame(() => this.fit());
  }

  applyTheme(theme: ResolvedTheme): void {
    this.term.options.theme = terminalTheme(theme);
  }

  /** Ends the shell but keeps the pane so it can be restarted. */
  async terminate(): Promise<void> {
    const id = this.backendId;
    if (!id) return;
    this.backendId = null;
    this.inputQueue = "";
    this.patch({ state: "exited", exitCode: null, backendId: null });
    this.writeBanner("\r\n\x1b[2m[Session terminated. Press Enter or use Restart to start a new shell.]\x1b[0m\r\n");
    try {
      await ipc.terminalClose(id);
    } catch (e) {
      void ipc.log("warn", "terminal", `close failed: ${errorMessage(e)}`);
    }
  }

  async restart(): Promise<void> {
    if (this.disposed || this.starting) return;
    if (this.backendId) await this.terminate();
    this.term.write("\r\n");
    await this.start();
  }

  /** Releases the PTY session and every browser-side resource. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.ackTimer);
    const id = this.backendId;
    this.backendId = null;
    this.disableWebgl();
    try {
      this.term.dispose();
    } catch {
      /* ignore */
    }
    this.element.remove();
    if (id) {
      try {
        await ipc.terminalClose(id);
      } catch {
        /* already closed */
      }
    }
  }
}
