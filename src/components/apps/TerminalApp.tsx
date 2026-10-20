import { TerminalPanel } from "@/components/terminal/TerminalPanel";

/** The workspace terminal (tabs, splits, search) in a desktop window. */
export default function TerminalApp() {
  return (
    <div className="h-full min-h-0">
      <TerminalPanel />
    </div>
  );
}
