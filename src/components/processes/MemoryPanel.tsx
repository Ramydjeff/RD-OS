import type { MemVar, ProcView } from "@/components/processes/engine";
import { ProcChip, StateBadge, procExitText } from "@/components/processes/simStyle";
import { cn } from "@/lib/cn";

function VarTable({ vars }: { vars: MemVar[] }) {
  if (vars.length === 0) return <p className="px-2 py-1 text-[11px] italic text-muted">aucune variable</p>;
  return (
    <table className="w-full table-fixed text-[11px]">
      <tbody>
        {vars.map((v) => (
          <tr key={v.name} className={cn("border-t border-line/50 first:border-t-0", v.changed && "bg-accent/10")}>
            <td className={cn("w-[34%] truncate py-0.5 pl-2 pr-1 font-mono font-semibold text-fg", v.changed && "border-l-2 border-accent")} title={v.name}>
              {v.name}
            </td>
            <td className="w-[22%] truncate py-0.5 pr-1 font-mono text-[10px] text-muted" title={v.type}>
              {v.type}
            </td>
            <td className="truncate py-0.5 pr-2 font-mono text-fg" title={v.value}>
              {v.value}
              {v.changed && <span className="ml-1.5 font-sans text-[9px] font-semibold uppercase tracking-wide text-accent">modifiée</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded border border-line/70">
      <div className="flex items-center justify-between border-b border-line/70 bg-elevated/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <span>{title}</span>
        {hint && <span className="normal-case tracking-normal font-normal">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function MemoryPanel({ proc, following }: { proc: ProcView | null; following: boolean }) {
  if (!proc) return <p className="p-3 text-xs text-muted">Sélectionnez un processus dans l'arbre.</p>;
  const mem = proc.mem;
  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <ProcChip proc={proc} />
        <span className="text-xs font-semibold text-fg">{proc.label}</span>
        <StateBadge state={proc.state} />
        <span className="font-mono text-[10px] text-muted">
          PID {proc.pid} · PPID {proc.ppid}
        </span>
        <span className="ml-auto text-[10px] text-muted">{following ? "suit le processus actif" : "sélection manuelle"}</span>
      </div>
      {proc.blockedOn && <p className="rounded bg-elevated px-2 py-1 text-[11px] text-fg">{proc.blockedOn}</p>}
      {proc.external && (
        <p className="rounded border border-line bg-elevated px-2 py-1.5 text-[11px] text-fg">
          Image remplacée par <span className="font-mono font-semibold">exec</span> : le processus exécute maintenant{" "}
          <span className="font-mono">« {proc.external} »</span>. Les variables du programme C n'existent plus.
        </p>
      )}
      {(proc.state === "TERMINATED" || proc.state === "ZOMBIE") && (
        <p className="rounded border border-line bg-elevated px-2 py-1.5 text-[11px] text-fg">
          Processus terminé ({procExitText(proc)}) : le noyau a libéré sa mémoire et fermé ses descripteurs.{" "}
          {proc.state === "ZOMBIE"
            ? "Il ne reste que son entrée dans la table des processus (PID et statut de fin), en attente du wait() de son père."
            : proc.reapedBy === 1
              ? "Son entrée a été retirée par init (PID 1)."
              : proc.reapedBy === 2000
                ? "Son entrée a été retirée par le shell bash."
                : `Son entrée a été retirée par le wait() de son père (PID ${proc.reapedBy ?? "?"}).`}
        </p>
      )}
      {mem && proc.state !== "TERMINATED" && proc.state !== "ZOMBIE" && (
        <>
          {mem.frames
            .slice()
            .reverse()
            .map((f, i) => (
              <Section key={`${f.func}-${i}`} title={i === 0 ? `Pile : ${f.func}()` : `appelée par ${f.func}()`} hint={`ligne ${f.line}`}>
                <VarTable vars={f.vars} />
              </Section>
            ))}
          {mem.globals.length > 0 && (
            <Section title="Variables globales" hint="copiées à chaque fork()">
              <VarTable vars={mem.globals} />
            </Section>
          )}
          {mem.heap.length > 0 && (
            <Section title="Tas (malloc)">
              <VarTable vars={mem.heap} />
            </Section>
          )}
          <Section
            title="Tampon stdout"
            hint={mem.bufferMode === "line" ? "vidé à chaque \\n" : mem.bufferMode === "full" ? "vidé quand il est plein ou à exit()" : "non bufferisé"}
          >
            <p className={cn("px-2 py-1 font-mono text-[11px]", mem.buffer ? "text-fg" : "italic text-muted")}>
              {mem.buffer ? `« ${mem.buffer.replace(/\n/g, "\\n")} »` : "vide"}
            </p>
          </Section>
        </>
      )}
      {proc.fds.length > 0 && (
        <Section title="Descripteurs ouverts">
          <ul className="px-2 py-1 font-mono text-[11px] text-fg">
            {proc.fds.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Section>
      )}
      {proc.parent !== null && mem && proc.state !== "TERMINATED" && proc.state !== "ZOMBIE" && (
        <p className="text-[10px] text-muted">
          Cette mémoire est une copie privée faite au fork() : la modifier ne change pas les variables des autres processus.
        </p>
      )}
    </div>
  );
}
