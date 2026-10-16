import { useMemo } from "react";
import { cn } from "@/lib/cn";

export type ProcessState = "RUNNING" | "SLEEPING" | "WAITING" | "ZOMBIE" | "TERMINATED" | "READY";

export interface SimulatedProcess {
  pid: number;
  ppid: number | null;
  name: string;
  funcName: string;
  state: ProcessState;
  currentLine: number;
  codeSnippet: string;
  sleepRemaining?: number;
  exitCode?: number | null;
  children: number[];
  startedAtStep: number;
  endedAtStep?: number;
}

interface ProcessTreeGraphProps {
  processes: Record<number, SimulatedProcess>;
  rootPid: number;
  selectedPid: number | null;
  onSelectProcess: (pid: number) => void;
}

const STATE_CONFIG: Record<
  ProcessState,
  { label: string; badge: string; border: string; glow: string; dot: string }
> = {
  RUNNING: {
    label: "Running",
    badge: "text-[#EA3843] bg-[#D6303A]/15 border-[#D6303A]/40",
    border: "border-[#D6303A]/70",
    glow: "shadow-[0_0_12px_rgba(214,48,58,0.25)]",
    dot: "bg-[#D6303A] animate-ping",
  },
  SLEEPING: {
    label: "Sleeping",
    badge: "text-[#38BDF8] bg-[#38BDF8]/15 border-[#38BDF8]/40",
    border: "border-[#38BDF8]/60",
    glow: "",
    dot: "bg-[#38BDF8]",
  },
  WAITING: {
    label: "Waiting",
    badge: "text-[#F59E0B] bg-[#F59E0B]/15 border-[#F59E0B]/40",
    border: "border-[#F59E0B]/60",
    glow: "",
    dot: "bg-[#F59E0B]",
  },
  ZOMBIE: {
    label: "Zombie",
    badge: "text-[#C084FC] bg-[#A855F7]/15 border-[#A855F7]/40",
    border: "border-[#A855F7]/60",
    glow: "",
    dot: "bg-[#A855F7]",
  },
  TERMINATED: {
    label: "Terminated",
    badge: "text-muted bg-surface border-line/40",
    border: "border-line/40 opacity-50",
    glow: "",
    dot: "bg-muted/40",
  },
  READY: {
    label: "Ready",
    badge: "text-[#4ADE80] bg-[#4ADE80]/15 border-[#4ADE80]/40",
    border: "border-[#4ADE80]/60",
    glow: "",
    dot: "bg-[#4ADE80]",
  },
};

interface LayoutNode {
  pid: number;
  x: number;
  y: number;
}

export function ProcessTreeGraph({
  processes,
  rootPid,
  selectedPid,
  onSelectProcess,
}: ProcessTreeGraphProps) {
  const { nodes, links, width, height } = useMemo(() => {
    const list: LayoutNode[] = [];
    const conns: { from: { x: number; y: number }; to: { x: number; y: number }; childPid: number }[] = [];
    const levels: Record<number, number[]> = {};

    function assignDepth(pid: number, depth: number) {
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(pid);
      const p = processes[pid];
      if (p) p.children.forEach((c) => assignDepth(c, depth + 1));
    }

    if (processes[rootPid]) assignDepth(rootPid, 0);

    const nodeWidth = 150;
    const nodeHeight = 58;
    const xGap = 24;
    const yGap = 44;

    const maxNodes = Math.max(1, ...Object.values(levels).map((l) => l.length));
    const totalW = Math.max(340, maxNodes * (nodeWidth + xGap) + 20);
    const positions: Record<number, { x: number; y: number }> = {};

    Object.entries(levels).forEach(([dStr, pids]) => {
      const depth = Number(dStr);
      const levelW = pids.length * (nodeWidth + xGap) - xGap;
      const startX = (totalW - levelW) / 2;
      const y = 16 + depth * (nodeHeight + yGap);

      pids.forEach((pid, idx) => {
        const x = startX + idx * (nodeWidth + xGap);
        positions[pid] = { x, y };
        list.push({ pid, x, y });
      });
    });

    list.forEach((node) => {
      const p = processes[node.pid];
      if (p) {
        p.children.forEach((childPid) => {
          const childPos = positions[childPid];
          if (childPos) {
            conns.push({
              from: { x: node.x + nodeWidth / 2, y: node.y + nodeHeight },
              to: { x: childPos.x + nodeWidth / 2, y: childPos.y },
              childPid,
            });
          }
        });
      }
    });

    const maxDepth = Math.max(0, ...Object.keys(levels).map(Number));
    const totalH = Math.max(220, 32 + (maxDepth + 1) * (nodeHeight + yGap));

    return { nodes: list, links: conns, width: totalW, height: totalH };
  }, [processes, rootPid]);

  return (
    <div className="relative w-full h-full min-h-[220px] overflow-auto flex items-center justify-center p-2">
      <div style={{ width, height }} className="relative select-none">
        <svg
          className="absolute inset-0 pointer-events-none"
          width={width}
          height={height}
          xmlns="http://www.w3.org/2000/svg"
        >
          {links.map((link, idx) => {
            const childProc = processes[link.childPid];
            const isTerm = childProc?.state === "TERMINATED";
            const midY = (link.from.y + link.to.y) / 2;
            const pathD = `M ${link.from.x} ${link.from.y} C ${link.from.x} ${midY}, ${link.to.x} ${midY}, ${link.to.x} ${link.to.y}`;

            return (
              <path
                key={idx}
                d={pathD}
                fill="none"
                stroke={isTerm ? "#262E27" : "#D6303A"}
                strokeWidth={1.5}
                strokeDasharray={isTerm ? "3 3" : undefined}
                strokeOpacity={isTerm ? 0.3 : 0.7}
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
          const p = processes[node.pid];
          if (!p) return null;
          const conf = STATE_CONFIG[p.state];
          const isSelected = selectedPid === p.pid;

          return (
            <div
              key={p.pid}
              onClick={() => onSelectProcess(p.pid)}
              style={{
                position: "absolute",
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: "150px",
                height: "58px",
              }}
              className={cn(
                "cursor-pointer rounded-md border bg-[#121613] px-2.5 py-1.5 transition-all flex flex-col justify-between",
                conf.border,
                isSelected ? "ring-1 ring-[#D6E7F3] bg-elevated scale-105 z-20" : "hover:border-[#D6E7F3]/50 z-10",
                p.state === "RUNNING" && conf.glow,
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-[11px] text-fg truncate">
                  {p.name}
                </span>
                <span className={cn("rounded px-1 text-[8px] font-bold uppercase border", conf.badge)}>
                  {p.state}
                </span>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-muted">
                <span>PID <strong className="text-[#D6E7F3]">{p.pid}</strong></span>
                <span className="truncate max-w-[65px] text-[9px] text-muted/70">
                  {p.codeSnippet}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
