import { useRef } from "react";
import { TerminalPane } from "@/components/terminal/TerminalPane";
import { cn } from "@/lib/cn";
import { collectLeaves, type PaneNode } from "@/lib/layoutTree";
import { useTerminals } from "@/store/terminals";

interface Props {
  node: PaneNode;
  tabId: string;
  tabActive: boolean;
  multi: boolean;
}

export function SplitView({ node, tabId, tabActive, multi }: Props) {
  if (node.type === "leaf") {
    return <TerminalPane terminalId={node.terminalId} paneId={node.id} tabId={tabId} tabActive={tabActive} showFocus={multi} />;
  }
  return <SplitNode node={node} tabId={tabId} tabActive={tabActive} multi={multi} />;
}

function SplitNode({ node, tabId, tabActive, multi }: Props & { node: Extract<PaneNode, { type: "split" }> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setRatio = useTerminals((s) => s.setSplitRatio);
  const horizontal = node.dir === "row";

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = container.getBoundingClientRect();
      const ratio = horizontal ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      setRatio(tabId, node.id, ratio);
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const grow = horizontal ? "ArrowRight" : "ArrowDown";
    const shrink = horizontal ? "ArrowLeft" : "ArrowUp";
    if (e.key === grow) setRatio(tabId, node.id, node.ratio + step);
    else if (e.key === shrink) setRatio(tabId, node.id, node.ratio - step);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={containerRef} className={cn("flex h-full w-full", horizontal ? "flex-row" : "flex-col")}>
      <div className="min-h-0 min-w-0 shrink-0 grow-0 overflow-hidden" style={{ flexBasis: `${node.ratio * 100}%` }}>
        <SplitView node={node.a} tabId={tabId} tabActive={tabActive} multi={multi} />
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-label="Resize terminal panes"
        aria-valuenow={Math.round(node.ratio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={cn(
          "shrink-0 bg-line transition-colors hover:bg-accent2/60 focus-visible:bg-accent2/60",
          horizontal ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        )}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <SplitView node={node.b} tabId={tabId} tabActive={tabActive} multi={multi} />
      </div>
    </div>
  );
}

export function paneCount(root: PaneNode): number {
  return collectLeaves(root).length;
}
