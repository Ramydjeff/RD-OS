import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  FileCode2,
  FileUp,
  GitFork,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";
import { ProcessTreeGraph, type SimulatedProcess } from "@/components/processes/ProcessTreeGraph";
import { analyzeAndSimulateCCode, type Scenario } from "@/components/processes/cProcessEngine";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { openTerminal } from "@/features/terminalActions";
import { toast } from "@/store/ui";
import { cn } from "@/lib/cn";

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

const TEMPLATES = [
  {
    name: "Exemple TD (2 forks)",
    desc: "2 forks avec fonctions p1(), p2() et p()",
    code: USER_CODE,
  },
  {
    name: "sleep() & wait()",
    desc: "Fork, sleep(2), exit et wait(NULL) père",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("[Pere %d] Demarrage du processus principal\\n", getpid());
    int pid = fork();
    if (pid == 0) {
        printf("[Fils %d] Je travaille pendant 2 secondes (PPID=%d)\\n", getpid(), getppid());
        sleep(2);
        printf("[Fils %d] Travail termine, j'appelle exit(0)\\n", getpid());
        exit(0);
    } else {
        printf("[Pere %d] Fils cree avec succes (%d). En attente...\\n", getpid(), pid);
        wait(NULL);
        printf("[Pere %d] Le fils est termine, fin du pere.\\n", getpid());
    }
    return 0;
}`,
  },
  {
    name: "Double fork en cascade",
    desc: "Création de 2 processus distincts avec wait",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

void f1() {
    printf("Fils 1 (PID: %d)\\n", getpid());
    exit(0);
}

void f2() {
    printf("Fils 2 (PID: %d)\\n", getpid());
    exit(0);
}

int main() {
    printf("Debut Pere (PID: %d)\\n", getpid());
    int id1 = fork();
    if (id1 == 0) f1();
    int id2 = fork();
    if (id2 == 0) f2();
    wait(NULL);
    wait(NULL);
    printf("Pere termine\\n");
    return 0;
}`,
  },
];

export function ProcessSimulator() {
  const [customScenarios, setCustomScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(DEFAULT_SCENARIO.id);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);

  // Custom C file upload / editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorCode, setEditorCode] = useState(USER_CODE);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allScenarios = useMemo(
    () => [...customScenarios, ...SCENARIOS],
    [customScenarios],
  );

  const scenario = useMemo(
    () => allScenarios.find((s) => s.id === selectedScenarioId) ?? allScenarios[0] ?? DEFAULT_SCENARIO,
    [allScenarios, selectedScenarioId],
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

  const loadCustomCode = (code: string, fileName: string) => {
    try {
      const generated = analyzeAndSimulateCCode(code, fileName);
      setCustomScenarios((prev) => {
        const filtered = prev.filter((s) => s.fileName !== fileName);
        return [generated, ...filtered];
      });
      setSelectedScenarioId(generated.id);
      setCurrentStepIdx(0);
      setIsPlaying(false);
      setSelectedPid(null);
      toast(
        "success",
        `Fichier "${fileName}" chargé avec succès (${generated.steps.length} étapes de déroulement générées).`,
      );
    } catch {
      toast("error", "Impossible de simuler ce code C.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        loadCustomCode(text, file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        loadCustomCode(text, file.name);
      }
    };
    reader.readAsText(file);
  };

  const handleRemoveCustomScenario = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomScenarios((prev) => prev.filter((s) => s.id !== id));
    if (selectedScenarioId === id) {
      setSelectedScenarioId(DEFAULT_SCENARIO.id);
      setCurrentStepIdx(0);
      setIsPlaying(false);
      setSelectedPid(null);
    }
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
    <div
      className="space-y-4 relative"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Hidden file input for native file browsing */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".c,.h,.cpp,.txt"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#EA3843] bg-[#0C0E0B]/90 backdrop-blur-sm pointer-events-none">
          <Upload size={38} className="text-[#EA3843] animate-bounce mb-2" />
          <p className="text-sm font-semibold text-fg">Déposez votre fichier .c ici</p>
          <p className="text-xs text-muted">Le simulateur analysera le code et affichera son déroulement</p>
        </div>
      )}

      {/* ── Compact Header & Player Toolbar ────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3">
        {/* Left: Title + File Picker + Scenario pills */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <GitFork size={15} className="text-[#D6303A]" />
            <span>Simulateur</span>
          </div>

          {/* Primary Action: Pick .c file */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#D6303A] hover:bg-[#EA3843] text-white shadow-sm font-medium text-xs px-2.5 py-1"
            title="Choisir un fichier .c sur votre disque"
          >
            <FileUp size={13} className="mr-1.5" /> Choisir fichier .c
          </Button>

          {/* Secondary Action: Code Editor Modal */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditorCode(scenario.code);
              setIsEditorOpen(true);
            }}
            className="text-xs text-[#D6E7F3] border-line hover:border-accent"
            title="Coller ou éditer du code C"
          >
            <FileCode2 size={13} className="mr-1.5 text-accent" /> Coller du code
          </Button>

          <span className="hidden sm:inline-block h-3.5 w-px bg-line/80 mx-0.5" />

          {/* Scenarios pills (custom files + presets) */}
          <div className="flex flex-wrap items-center rounded-md border border-line bg-surface p-0.5 gap-0.5">
            {allScenarios.map((s) => {
              const isSelected = selectedScenarioId === s.id;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[#D6303A] text-white shadow-sm"
                      : "text-muted hover:text-fg hover:bg-elevated/40",
                  )}
                  onClick={() => handleSelectScenario(s.id)}
                >
                  <span className="truncate max-w-[140px]">{s.title}</span>
                  {s.isCustom && (
                    <button
                      type="button"
                      onClick={(e) => handleRemoveCustomScenario(s.id, e)}
                      className="ml-0.5 text-white/70 hover:text-white transition-opacity"
                      title="Fermer ce fichier"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
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
            title="Étape précédente"
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
            title="Étape suivante"
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
            <div className="flex items-center gap-2 text-[10px] text-muted">
              {scenario.isCustom && (
                <span className="text-accent bg-accent/15 px-1.5 py-0.5 rounded font-mono">
                  Fichier C analysé
                </span>
              )}
              <span>Ligne {currentStep.line}</span>
            </div>
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
              <span className="flex items-center gap-1.5 text-fg font-medium truncate">
                <Code2 size={13} className="text-[#D6303A] shrink-0" />
                <span className="truncate">{scenario.fileName ?? scenario.title}</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] hover:text-fg transition-colors flex items-center gap-1 px-1.5 py-0.5 rounded border border-line/60 hover:border-accent"
                  title="Choisir un autre fichier .c"
                >
                  <FileUp size={10} /> Parcourir...
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditorCode(scenario.code);
                    setIsEditorOpen(true);
                  }}
                  className="text-[10px] hover:text-fg transition-colors flex items-center gap-1 px-1.5 py-0.5 rounded border border-line/60 hover:border-accent"
                  title="Modifier le code"
                >
                  <FileCode2 size={10} /> Modifier
                </button>
                <button
                  type="button"
                  onClick={copyCode}
                  className="text-[10px] hover:text-fg transition-colors flex items-center gap-1 px-1.5 py-0.5 rounded border border-line/60 hover:border-accent"
                >
                  <Copy size={10} /> Copier
                </button>
              </div>
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

      {/* ── Modal: C Code Editor / Paste ───────────────────────────────── */}
      {isEditorOpen && (
        <Modal
          title="Éditer ou coller du Code C"
          onClose={() => setIsEditorOpen(false)}
          width="max-w-2xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <Button variant="ghost" size="sm" onClick={() => setIsEditorOpen(false)}>
                Annuler
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  loadCustomCode(editorCode, "code_personnalise.c");
                  setIsEditorOpen(false);
                }}
                className="bg-[#D6303A] hover:bg-[#EA3843] text-white shadow-sm"
              >
                <Sparkles size={13} className="mr-1.5" /> Lancer la Simulation
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Collez votre propre code C ou modifiez-le. Le moteur analysera vos appels à{" "}
              <code className="text-[#EA3843]">fork()</code>,{" "}
              <code className="text-[#EA3843]">wait()</code>,{" "}
              <code className="text-[#EA3843]">sleep()</code>,{" "}
              <code className="text-[#EA3843]">exit()</code> et{" "}
              <code className="text-[#EA3843]">printf()</code> pour simuler son déroulement complet.
            </p>

            {/* Quick Templates */}
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted">Modèles rapides :</span>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.name}
                    type="button"
                    onClick={() => setEditorCode(tmpl.code)}
                    className="rounded border border-line bg-surface/80 px-2 py-1 text-[11px] text-[#D6E7F3] hover:border-accent hover:text-white transition-colors"
                  >
                    {tmpl.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Textarea */}
            <div className="relative rounded-lg border border-line bg-[#0C0E0B] p-2">
              <textarea
                value={editorCode}
                onChange={(e) => setEditorCode(e.target.value)}
                rows={14}
                className="w-full resize-y bg-transparent font-mono text-xs text-[#D6E7F3] outline-none leading-5"
                placeholder="#include <stdio.h>&#10;#include <unistd.h>&#10;int main() { ... }"
                spellCheck={false}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

