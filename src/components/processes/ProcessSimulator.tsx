import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  GitFork,
  Pause,
  Play,
  RotateCcw,
  TerminalSquare,
} from "lucide-react";
import { ProcessTreeGraph, type SimulatedProcess } from "@/components/processes/ProcessTreeGraph";
import { Button } from "@/components/ui/Button";
import { openTerminal } from "@/features/terminalActions";
import { toast } from "@/store/ui";
import { cn } from "@/lib/cn";

interface SimStep {
  stepIndex: number;
  title: string;
  explanation: string;
  activePid: number;
  line: number;
  processes: Record<number, SimulatedProcess>;
  outputLine?: string;
}

interface Scenario {
  id: string;
  title: string;
  code: string;
  steps: SimStep[];
}

const USER_CODE = `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

void p(){
    printf("je suis le processus pere %d \\n", getpid());
}
void p1(){
    printf("je suis le processus fils 1 %d \\n", getpid());
    exit(0);
}
void p2(){
    printf("je suis le processus fils 2 %d \\n", getpid());
    exit(0);
}

int main(){
    printf("salam WAALIKOM\\n");
    int id = fork();
    if (id == 0 ){p1();}
    id = fork();
    if (id == 0 ){p2();}
    p();
    wait(0);
    wait(0);
    return 0;
}`;

const SCENARIOS: Scenario[] = [
  {
    id: "user-fork-wait",
    title: "Exemple d'étude (2 forks)",
    code: USER_CODE,
    steps: [
      {
        stepIndex: 0,
        title: "Démarrage main()",
        explanation: "Le processus père (PID 2001) démarre son exécution dans main().",
        activePid: 2001,
        line: 18,
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 18,
            codeSnippet: "main() start",
            children: [],
            startedAtStep: 0,
          },
        },
      },
      {
        stepIndex: 1,
        title: "printf('salam WAALIKOM')",
        explanation: "Le père affiche le message initial sur la sortie standard.",
        activePid: 2001,
        line: 19,
        outputLine: "salam WAALIKOM",
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 19,
            codeSnippet: "printf()",
            children: [],
            startedAtStep: 0,
          },
        },
      },
      {
        stepIndex: 2,
        title: "Premier fork() : Création du Fils 1",
        explanation: "fork() crée le Fils 1 (PID 2002). Dans le père id=2002, dans le fils id=0.",
        activePid: 2001,
        line: 20,
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 20,
            codeSnippet: "id = 2002",
            children: [2002],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "READY",
            currentLine: 20,
            codeSnippet: "id = 0",
            children: [],
            startedAtStep: 2,
          },
        },
      },
      {
        stepIndex: 3,
        title: "Fils 1 exécute p1()",
        explanation: "Chez le Fils 1 (id == 0), p1() s'exécute, affiche son PID et appelle exit(0).",
        activePid: 2002,
        line: 11,
        outputLine: "je suis le processus fils 1 2002",
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "READY",
            currentLine: 22,
            codeSnippet: "next fork()",
            children: [2002],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 2,
            endedAtStep: 3,
          },
        },
      },
      {
        stepIndex: 4,
        title: "Deuxième fork() : Création du Fils 2",
        explanation: "Le père appelle le second fork(). Le noyau crée le Fils 2 (PID 2003).",
        activePid: 2001,
        line: 22,
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 22,
            codeSnippet: "id = 2003",
            children: [2002, 2003],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 2,
            endedAtStep: 3,
          },
          2003: {
            pid: 2003,
            ppid: 2001,
            name: "Fils 2 (p2)",
            funcName: "p2()",
            state: "READY",
            currentLine: 22,
            codeSnippet: "id = 0",
            children: [],
            startedAtStep: 4,
          },
        },
      },
      {
        stepIndex: 5,
        title: "Fils 2 exécute p2()",
        explanation: "Chez le Fils 2 (id == 0), p2() s'exécute, affiche son PID et appelle exit(0).",
        activePid: 2003,
        line: 15,
        outputLine: "je suis le processus fils 2 2003",
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "READY",
            currentLine: 24,
            codeSnippet: "call p()",
            children: [2002, 2003],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 2,
            endedAtStep: 3,
          },
          2003: {
            pid: 2003,
            ppid: 2001,
            name: "Fils 2 (p2)",
            funcName: "p2()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 16,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 4,
            endedAtStep: 5,
          },
        },
      },
      {
        stepIndex: 6,
        title: "Père exécute p()",
        explanation: "Le père appelle p() et affiche son PID (2001).",
        activePid: 2001,
        line: 7,
        outputLine: "je suis le processus pere 2001",
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "p()",
            state: "RUNNING",
            currentLine: 7,
            codeSnippet: "p()",
            children: [2002, 2003],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 2,
            endedAtStep: 3,
          },
          2003: {
            pid: 2003,
            ppid: 2001,
            name: "Fils 2 (p2)",
            funcName: "p2()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 16,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 4,
            endedAtStep: 5,
          },
        },
      },
      {
        stepIndex: 7,
        title: "wait(0) #1 : Récupération du Fils 1",
        explanation: "Le père appelle wait(0) et récupère le code de retour du Fils 1.",
        activePid: 2001,
        line: 25,
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 25,
            codeSnippet: "wait() #1",
            children: [2002, 2003],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "terminated",
            children: [],
            startedAtStep: 2,
            endedAtStep: 7,
          },
          2003: {
            pid: 2003,
            ppid: 2001,
            name: "Fils 2 (p2)",
            funcName: "p2()",
            state: "ZOMBIE",
            exitCode: 0,
            currentLine: 16,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 4,
            endedAtStep: 5,
          },
        },
      },
      {
        stepIndex: 8,
        title: "wait(0) #2 : Récupération du Fils 2",
        explanation: "Le père appelle le second wait(0) et récupère le Fils 2. Les deux fils sont nettoyés.",
        activePid: 2001,
        line: 26,
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 26,
            codeSnippet: "wait() #2",
            children: [2002, 2003],
            startedAtStep: 0,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "terminated",
            children: [],
            startedAtStep: 2,
            endedAtStep: 7,
          },
          2003: {
            pid: 2003,
            ppid: 2001,
            name: "Fils 2 (p2)",
            funcName: "p2()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 16,
            codeSnippet: "terminated",
            children: [],
            startedAtStep: 4,
            endedAtStep: 8,
          },
        },
      },
      {
        stepIndex: 9,
        title: "return 0 : Fin normale",
        explanation: "Le processus père se termine proprement avec return 0.",
        activePid: 2001,
        line: 27,
        processes: {
          2001: {
            pid: 2001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 27,
            codeSnippet: "exit 0",
            children: [2002, 2003],
            startedAtStep: 0,
            endedAtStep: 9,
          },
          2002: {
            pid: 2002,
            ppid: 2001,
            name: "Fils 1 (p1)",
            funcName: "p1()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 12,
            codeSnippet: "terminated",
            children: [],
            startedAtStep: 2,
            endedAtStep: 7,
          },
          2003: {
            pid: 2003,
            ppid: 2001,
            name: "Fils 2 (p2)",
            funcName: "p2()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 16,
            codeSnippet: "terminated",
            children: [],
            startedAtStep: 4,
            endedAtStep: 8,
          },
        },
      },
    ],
  },
  {
    id: "sleep-wait",
    title: "sleep() & wait()",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("[Pere %d] Demarrage\\n", getpid());
    pid_t pid = fork();
    if (pid == 0) {
        printf("[Fils %d] Je dors 2 secondes...\\n", getpid());
        sleep(2);
        printf("[Fils %d] Reveil et exit\\n", getpid());
        exit(0);
    }
    printf("[Pere %d] Attente avec wait()...\\n", getpid());
    wait(NULL);
    printf("[Pere %d] Fils termine, fin du pere.\\n", getpid());
    return 0;
}`,
    steps: [
      {
        stepIndex: 0,
        title: "Démarrage et fork()",
        explanation: "Le père (PID 3001) démarre et fork() le fils (PID 3002).",
        activePid: 3001,
        line: 7,
        outputLine: "[Pere 3001] Demarrage",
        processes: {
          3001: {
            pid: 3001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 7,
            codeSnippet: "fork()",
            children: [3002],
            startedAtStep: 0,
          },
          3002: {
            pid: 3002,
            ppid: 3001,
            name: "Fils",
            funcName: "main()",
            state: "READY",
            currentLine: 8,
            codeSnippet: "ready",
            children: [],
            startedAtStep: 0,
          },
        },
      },
      {
        stepIndex: 1,
        title: "Fils appelle sleep(2)",
        explanation: "Le fils passe en état SLEEPING (bloqué pendant 2 secondes).",
        activePid: 3002,
        line: 11,
        outputLine: "[Fils 3002] Je dors 2 secondes...",
        processes: {
          3001: {
            pid: 3001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "RUNNING",
            currentLine: 14,
            codeSnippet: "run",
            children: [3002],
            startedAtStep: 0,
          },
          3002: {
            pid: 3002,
            ppid: 3001,
            name: "Fils",
            funcName: "main()",
            state: "SLEEPING",
            sleepRemaining: 2,
            currentLine: 11,
            codeSnippet: "sleep(2)",
            children: [],
            startedAtStep: 0,
          },
        },
      },
      {
        stepIndex: 2,
        title: "Père appelle wait()",
        explanation: "Le père appelle wait(NULL) et passe en état WAITING jusqu'au réveil du fils.",
        activePid: 3001,
        line: 15,
        outputLine: "[Pere 3001] Attente avec wait()...",
        processes: {
          3001: {
            pid: 3001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "WAITING",
            currentLine: 15,
            codeSnippet: "waiting",
            children: [3002],
            startedAtStep: 0,
          },
          3002: {
            pid: 3002,
            ppid: 3001,
            name: "Fils",
            funcName: "main()",
            state: "SLEEPING",
            sleepRemaining: 1,
            currentLine: 11,
            codeSnippet: "sleep(1)",
            children: [],
            startedAtStep: 0,
          },
        },
      },
      {
        stepIndex: 3,
        title: "Réveil du fils et exit(0)",
        explanation: "Le fils se réveille, affiche son message et se termine.",
        activePid: 3002,
        line: 13,
        outputLine: "[Fils 3002] Reveil et exit",
        processes: {
          3001: {
            pid: 3001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "WAITING",
            currentLine: 15,
            codeSnippet: "wait()",
            children: [3002],
            startedAtStep: 0,
          },
          3002: {
            pid: 3002,
            ppid: 3001,
            name: "Fils",
            funcName: "main()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 13,
            codeSnippet: "exit(0)",
            children: [],
            startedAtStep: 0,
            endedAtStep: 3,
          },
        },
      },
      {
        stepIndex: 4,
        title: "Déblocage du père et fin",
        explanation: "wait() est débloqué. Le père affiche la confirmation et termine.",
        activePid: 3001,
        line: 16,
        outputLine: "[Pere 3001] Fils termine, fin du pere.",
        processes: {
          3001: {
            pid: 3001,
            ppid: null,
            name: "Père",
            funcName: "main()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 17,
            codeSnippet: "exit 0",
            children: [3002],
            startedAtStep: 0,
            endedAtStep: 4,
          },
          3002: {
            pid: 3002,
            ppid: 3001,
            name: "Fils",
            funcName: "main()",
            state: "TERMINATED",
            exitCode: 0,
            currentLine: 13,
            codeSnippet: "terminated",
            children: [],
            startedAtStep: 0,
            endedAtStep: 3,
          },
        },
      },
    ],
  },
];

const DEFAULT_SCENARIO = SCENARIOS[0]!;

export function ProcessSimulator() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(DEFAULT_SCENARIO.id);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === selectedScenarioId) ?? DEFAULT_SCENARIO,
    [selectedScenarioId],
  );

  const currentStep = scenario.steps[currentStepIdx] ?? scenario.steps[0]!;
  const maxStep = scenario.steps.length - 1;

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentStepIdx((prev) => {
        if (prev >= maxStep) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [isPlaying, maxStep]);

  const handleSelectScenario = (id: string) => {
    setSelectedScenarioId(id);
    setCurrentStepIdx(0);
    setIsPlaying(false);
    setSelectedPid(null);
  };

  const stdoutLines = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i <= currentStepIdx; i++) {
      const line = scenario.steps[i]?.outputLine;
      if (line) list.push(line);
    }
    return list;
  }, [scenario, currentStepIdx]);

  const codeLines = useMemo(() => scenario.code.split("\n"), [scenario.code]);

  const rootPid = useMemo(() => {
    const pids = Object.keys(currentStep.processes).map(Number);
    const root = pids.find((p) => currentStep.processes[p]?.ppid === null);
    return root ?? pids[0] ?? 2001;
  }, [currentStep]);

  const handleRunInWsl = async () => {
    try {
      await openTerminal();
      toast("info", "Terminal ouvert pour exécuter et tester vos processus.");
    } catch {
      toast("error", "Impossible d'ouvrir le terminal.");
    }
  };

  const copyCode = () => {
    void navigator.clipboard.writeText(scenario.code);
    toast("success", "Code source C copié !");
  };

  return (
    <div className="space-y-4">
      {/* ── Compact Header & Player Toolbar ────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3">
        {/* Left: Title + Scenario pills */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <GitFork size={15} className="text-[#D6303A]" />
            <span>Simulateur</span>
          </div>

          <div className="flex items-center rounded-md border border-line bg-surface p-0.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectScenario(s.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  selectedScenarioId === s.id
                    ? "bg-[#D6303A] text-white shadow-sm"
                    : "text-muted hover:text-fg",
                )}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Step controls & Run button */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={currentStepIdx === 0}
            onClick={() => {
              setIsPlaying(false);
              setCurrentStepIdx((p) => Math.max(0, p - 1));
            }}
          >
            <ChevronLeft size={13} />
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (currentStepIdx >= maxStep) setCurrentStepIdx(0);
              setIsPlaying(!isPlaying);
            }}
            className="px-3"
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            <span className="ml-1 text-xs">{isPlaying ? "Pause" : "Lecture"}</span>
          </Button>

          <Button
            size="sm"
            disabled={currentStepIdx >= maxStep}
            onClick={() => {
              setIsPlaying(false);
              setCurrentStepIdx((p) => Math.min(maxStep, p + 1));
            }}
          >
            <ChevronRight size={13} />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsPlaying(false);
              setCurrentStepIdx(0);
            }}
            title="Réinitialiser"
          >
            <RotateCcw size={12} />
          </Button>

          <span className="text-xs text-muted font-mono px-1">
            {currentStepIdx + 1}/{scenario.steps.length}
          </span>

          <span className="h-3.5 w-px bg-line/60 mx-1" />

          <Button
            size="sm"
            variant="secondary"
            onClick={handleRunInWsl}
            className="text-[#D6E7F3] hover:border-accent"
          >
            <TerminalSquare size={13} /> Terminal
          </Button>
        </div>
      </div>

      {/* ── Current Step Explanation ───────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-[#D6E7F3] bg-surface/60 border border-line/40 rounded-md px-3 py-1.5">
        <span className="font-semibold text-[#D6303A] shrink-0">
          Étape {currentStepIdx + 1} :
        </span>
        <span className="truncate flex-1 text-fg">{currentStep.explanation}</span>
        <span className="font-mono text-[10px] text-muted shrink-0">
          Actif : PID {currentStep.activePid}
        </span>
      </div>

      {/* ── Main 2-Column Clean Layout ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column (7 cols): Process Tree */}
        <div className="lg:col-span-7 flex flex-col rounded-lg border border-line bg-surface overflow-hidden min-h-[340px]">
          <div className="flex items-center justify-between border-b border-line bg-elevated/40 px-3 py-2 text-xs font-medium text-muted">
            <span className="flex items-center gap-1.5 text-fg">
              <GitFork size={13} className="text-[#D6303A]" /> Arbre des Processus (PID Tree)
            </span>
            <span className="text-[10px] text-muted">Ligne {currentStep.line}</span>
          </div>

          <div className="flex-1 flex items-center justify-center p-2 bg-[#0C0E0B]/50">
            <ProcessTreeGraph
              processes={currentStep.processes}
              rootPid={rootPid}
              selectedPid={selectedPid}
              onSelectProcess={setSelectedPid}
            />
          </div>
        </div>

        {/* Right Column (5 cols): Code + Stdout Terminal */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* C Code snippet */}
          <div className="flex flex-col rounded-lg border border-line bg-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-elevated/40 px-3 py-1.5 text-xs text-muted">
              <span className="flex items-center gap-1 text-fg font-medium">
                <Code2 size={13} className="text-[#D6303A]" /> Code C
              </span>
              <button
                type="button"
                onClick={copyCode}
                className="text-[10px] hover:text-fg transition-colors flex items-center gap-1"
              >
                <Copy size={11} /> Copier
              </button>
            </div>

            <div className="max-h-56 overflow-y-auto bg-[#0C0E0B] p-2 font-mono text-[11px] leading-4 text-muted">
              {codeLines.map((codeLine, idx) => {
                const lineNum = idx + 1;
                const isCurrent = lineNum === currentStep.line;

                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-2 px-1.5 py-px rounded",
                      isCurrent && "bg-[#D6303A]/20 border-l-2 border-[#D6303A] text-white font-semibold",
                    )}
                  >
                    <span className="w-5 select-none text-right text-[9px] text-muted/50">
                      {lineNum}
                    </span>
                    <span className="truncate flex-1">{codeLine}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Virtual Terminal Stdout */}
          <div className="flex flex-col rounded-lg border border-line bg-surface overflow-hidden flex-1">
            <div className="flex items-center justify-between border-b border-line bg-elevated/40 px-3 py-1.5 text-xs text-muted">
              <span className="flex items-center gap-1 text-fg font-medium">
                <TerminalSquare size={13} className="text-[#D6303A]" /> Sortie (stdout)
              </span>
              <span className="text-[10px] text-muted font-mono">{stdoutLines.length}</span>
            </div>

            <div className="min-h-[90px] flex-1 bg-[#0C0E0B] p-2.5 font-mono text-xs text-[#D6E7F3] space-y-0.5">
              {stdoutLines.length === 0 ? (
                <p className="text-muted/40 italic text-[11px]">En attente de sortie...</p>
              ) : (
                stdoutLines.map((line, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[#D6303A] text-[10px]">&gt;</span>
                    <span className="text-white font-medium">{line}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
