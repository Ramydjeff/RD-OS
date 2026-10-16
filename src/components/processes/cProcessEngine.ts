import type { SimulatedProcess } from "@/components/processes/ProcessTreeGraph";

export interface SimStep {
  stepIndex: number;
  title: string;
  explanation: string;
  activePid: number;
  line: number;
  processes: Record<number, SimulatedProcess>;
  outputLine?: string;
}

export interface Scenario {
  id: string;
  title: string;
  code: string;
  steps: SimStep[];
  isCustom?: boolean;
  fileName?: string;
  forkCount?: number;
}

interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  lines: { lineNum: number; text: string }[];
}

/**
 * Strips comments from C code while preserving exact line count and character positions.
 */
function cleanCommentsPreservingLines(src: string): string[] {
  const lines = src.split(/\r?\n/);
  let inMultiComment = false;

  return lines.map((line) => {
    let result = "";
    let i = 0;

    while (i < line.length) {
      if (inMultiComment) {
        if (line[i] === "*" && line[i + 1] === "/") {
          inMultiComment = false;
          result += "  ";
          i += 2;
        } else {
          result += " ";
          i++;
        }
      } else {
        if (line[i] === "/" && line[i + 1] === "*") {
          inMultiComment = true;
          result += "  ";
          i += 2;
        } else if (line[i] === "/" && line[i + 1] === "/") {
          // Rest of line is single comment
          result += " ".repeat(line.length - i);
          break;
        } else {
          result += line[i];
          i++;
        }
      }
    }
    return result;
  });
}

/**
 * Extract functions from C source code.
 */
function extractFunctions(lines: string[]): {
  functions: Map<string, ParsedFunction>;
  mainFunc: ParsedFunction | null;
} {
  const functions = new Map<string, ParsedFunction>();
  let mainFunc: ParsedFunction | null = null;

  let currentFunc: {
    name: string;
    startLine: number;
    lines: { lineNum: number; text: string }[];
    braceDepth: number;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();
    const lineNum = i + 1;

    // Detect function signature if not inside a function
    if (!currentFunc) {
      const funcMatch = trimmed.match(
        /^(?:void|int|pid_t|char|double|float)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{?/,
      );
      if (funcMatch && funcMatch[1]) {
        const name = funcMatch[1];
        let braceDepth = 0;
        for (const ch of trimmed) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        currentFunc = {
          name,
          startLine: lineNum,
          lines: [{ lineNum, text: trimmed }],
          braceDepth,
        };

        if (braceDepth === 0 && trimmed.includes("{") && trimmed.includes("}")) {
          // Single-line function
          const fn: ParsedFunction = {
            name,
            startLine: lineNum,
            endLine: lineNum,
            lines: [{ lineNum, text: trimmed }],
          };
          if (name === "main") mainFunc = fn;
          else functions.set(name, fn);
          currentFunc = null;
        }
        continue;
      }
    } else {
      // Inside function
      for (const ch of trimmed) {
        if (ch === "{") currentFunc.braceDepth++;
        if (ch === "}") currentFunc.braceDepth--;
      }
      currentFunc.lines.push({ lineNum, text: trimmed });

      if (currentFunc.braceDepth <= 0 && currentFunc.lines.some((l) => l.text.includes("{"))) {
        const fn: ParsedFunction = {
          name: currentFunc.name,
          startLine: currentFunc.startLine,
          endLine: lineNum,
          lines: currentFunc.lines,
        };
        if (currentFunc.name === "main") {
          mainFunc = fn;
        } else {
          functions.set(currentFunc.name, fn);
        }
        currentFunc = null;
      }
    }
  }

  return { functions, mainFunc };
}

/**
 * Format string interpolation for simulated printf.
 */
function interpolatePrintf(
  text: string,
  pid: number,
  ppid: number | null,
  childPid?: number,
): string {
  const match = text.match(/printf\s*\(\s*"([^"]*)"(.*)\)/);
  if (!match || !match[1]) {
    return "stdout";
  }

  let fmt = match[1];
  const argsStr = match[2] ? match[2].replace(/^,/, "").trim() : "";
  const args = argsStr ? argsStr.split(",").map((s) => s.trim()) : [];

  // Replace common escapes
  fmt = fmt.replace(/\\n/g, "").replace(/\\t/g, "  ");

  // Substitute %d / %i with arg values
  let argIdx = 0;
  fmt = fmt.replace(/%d|%i|%u/g, () => {
    const curArg = args[argIdx++] ?? "";
    if (curArg.includes("getppid")) return String(ppid ?? 1);
    if (curArg.includes("getpid")) return String(pid);
    if (childPid && (curArg.includes("id") || curArg.includes("pid"))) return String(childPid);
    return String(pid);
  });

  return fmt.trim();
}

/**
 * Main parser and simulator for C code.
 */
export function analyzeAndSimulateCCode(sourceCode: string, fileName = "custom.c"): Scenario {
  const rawLines = sourceCode.split(/\r?\n/);
  const cleanLines = cleanCommentsPreservingLines(sourceCode);
  const { functions, mainFunc } = extractFunctions(cleanLines);

  const steps: SimStep[] = [];
  let stepIndex = 0;
  let nextPid = 2002;
  const rootPid = 2001;

  // Active simulated processes
  const processes: Record<number, SimulatedProcess> = {
    [rootPid]: {
      pid: rootPid,
      ppid: null,
      name: "Père",
      funcName: "main()",
      state: "RUNNING",
      currentLine: mainFunc?.startLine ?? 1,
      codeSnippet: "main() start",
      children: [],
      startedAtStep: 0,
    },
  };

  function cloneProcesses(): Record<number, SimulatedProcess> {
    const copy: Record<number, SimulatedProcess> = {};
    for (const [key, val] of Object.entries(processes)) {
      copy[Number(key)] = {
        ...val,
        children: [...val.children],
      };
    }
    return copy;
  }

  // Count total forks
  let totalForks = 0;
  for (const line of cleanLines) {
    if (/\bfork\s*\(\s*\)/.test(line)) totalForks++;
  }

  // Step 0: Start of main
  steps.push({
    stepIndex: stepIndex++,
    title: "Démarrage main()",
    explanation: `Le processus père (PID ${rootPid}) démarre son exécution dans main().`,
    activePid: rootPid,
    line: mainFunc?.startLine ?? 1,
    processes: cloneProcesses(),
  });

  // Track children metadata
  interface ChildMeta {
    pid: number;
    parentPid: number;
    name: string;
    branchLine?: number;
    funcCalled?: string;
  }
  const createdChildren: ChildMeta[] = [];
  const zombieQueue: number[] = [];

  // Parse lines inside main
  const mainLines = mainFunc ? mainFunc.lines.slice(1, -1) : cleanLines.map((text, idx) => ({ lineNum: idx + 1, text }));

  let childCounter = 1;
  let currentForkVar: string | null = null;

  for (let i = 0; i < mainLines.length; i++) {
    const item = mainLines[i];
    if (!item) continue;
    const { lineNum, text } = item;
    const trimmed = text.trim();
    if (!trimmed || trimmed === "{" || trimmed === "}") continue;

    // 1. Detect fork()
    if (/\bfork\s*\(\s*\)/.test(trimmed)) {
      const varMatch = trimmed.match(/(?:int|pid_t)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*fork\s*\(\s*\)/);
      currentForkVar = varMatch ? varMatch[1] ?? null : "id";

      const childPid = nextPid++;
      const childName = `Fils ${childCounter++}`;

      // Update parent
      processes[rootPid]!.children.push(childPid);
      processes[rootPid]!.currentLine = lineNum;
      processes[rootPid]!.codeSnippet = `${currentForkVar} = ${childPid}`;

      // Create child
      processes[childPid] = {
        pid: childPid,
        ppid: rootPid,
        name: childName,
        funcName: "main()",
        state: "READY",
        currentLine: lineNum,
        codeSnippet: `${currentForkVar} = 0`,
        children: [],
        startedAtStep: stepIndex,
      };

      createdChildren.push({
        pid: childPid,
        parentPid: rootPid,
        name: childName,
      });

      steps.push({
        stepIndex: stepIndex++,
        title: `fork() : Création de ${childName}`,
        explanation: `fork() crée le ${childName} (PID ${childPid}). Dans le père ${currentForkVar}=${childPid}, dans le fils ${currentForkVar}=0.`,
        activePid: rootPid,
        line: lineNum,
        processes: cloneProcesses(),
      });

      // Look ahead for if (id == 0) or if (fork() == 0)
      const nextItem = mainLines[i + 1];
      if (nextItem && (nextItem.text.includes("== 0") || nextItem.text.includes("!id"))) {
        const condLine = nextItem.lineNum;
        const condText = nextItem.text.trim();

        // Check if a function is called e.g. p1();
        const callMatch = condText.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)\s*;/);
        let calledFnName: string | null = null;
        if (callMatch && callMatch[1] && callMatch[1] !== "fork" && callMatch[1] !== "exit" && callMatch[1] !== "printf") {
          calledFnName = callMatch[1];
        }

        const childMeta = createdChildren[createdChildren.length - 1];
        if (childMeta) {
          childMeta.branchLine = condLine;
          childMeta.funcCalled = calledFnName ?? undefined;
        }

        // Child process takes if-branch
        processes[childPid]!.state = "RUNNING";
        processes[childPid]!.currentLine = condLine;
        if (calledFnName) {
          processes[childPid]!.funcName = `${calledFnName}()`;
          processes[childPid]!.name = `${childName} (${calledFnName})`;
        }

        // If called function exists, step through it!
        const calledFn = calledFnName ? functions.get(calledFnName) : null;
        if (calledFn) {
          steps.push({
            stepIndex: stepIndex++,
            title: `${childName} entre dans if(${currentForkVar} == 0)`,
            explanation: `Chez le ${childName} (${currentForkVar} == 0 est VRAI), exécution de la branche fille : appel de ${calledFnName}().`,
            activePid: childPid,
            line: condLine,
            processes: cloneProcesses(),
          });

          // Step through lines of function
          for (const fnLine of calledFn.lines) {
            const fTrim = fnLine.text.trim();
            if (fTrim.includes("printf")) {
              const out = interpolatePrintf(fTrim, childPid, rootPid);
              processes[childPid]!.currentLine = fnLine.lineNum;
              processes[childPid]!.codeSnippet = "printf()";

              steps.push({
                stepIndex: stepIndex++,
                title: `${childName} : printf()`,
                explanation: `Le ${childName} (PID ${childPid}) affiche son message dans ${calledFnName}().`,
                activePid: childPid,
                line: fnLine.lineNum,
                outputLine: out,
                processes: cloneProcesses(),
              });
            } else if (fTrim.includes("sleep")) {
              const sleepMatch = fTrim.match(/sleep\s*\(\s*(\d+)\s*\)/);
              const sec = sleepMatch ? sleepMatch[1] : "1";
              processes[childPid]!.state = "SLEEPING";
              processes[childPid]!.currentLine = fnLine.lineNum;
              processes[childPid]!.sleepRemaining = Number(sec);

              steps.push({
                stepIndex: stepIndex++,
                title: `${childName} : sleep(${sec})`,
                explanation: `Le ${childName} (PID ${childPid}) s'endort pendant ${sec}s (état SLEEPING).`,
                activePid: childPid,
                line: fnLine.lineNum,
                processes: cloneProcesses(),
              });
            } else if (fTrim.includes("exit")) {
              processes[childPid]!.state = "ZOMBIE";
              processes[childPid]!.exitCode = 0;
              processes[childPid]!.currentLine = fnLine.lineNum;
              processes[childPid]!.codeSnippet = "exit(0)";
              processes[childPid]!.endedAtStep = stepIndex;
              zombieQueue.push(childPid);

              steps.push({
                stepIndex: stepIndex++,
                title: `${childName} : exit(0)`,
                explanation: `Le ${childName} (PID ${childPid}) appelle exit(0) et termine. Il devient ZOMBIE en attente d'un wait() du père.`,
                activePid: childPid,
                line: fnLine.lineNum,
                processes: cloneProcesses(),
              });
            }
          }

          // If child didn't call exit(), it exits naturally at end of function
          if (processes[childPid]!.state !== "ZOMBIE" && processes[childPid]!.state !== "TERMINATED") {
            processes[childPid]!.state = "ZOMBIE";
            processes[childPid]!.exitCode = 0;
            processes[childPid]!.endedAtStep = stepIndex;
            zombieQueue.push(childPid);
          }
        } else {
          // Inlined statements in if block
          if (condText.includes("printf")) {
            const out = interpolatePrintf(condText, childPid, rootPid);
            steps.push({
              stepIndex: stepIndex++,
              title: `${childName} exécute sa branche`,
              explanation: `Le ${childName} (PID ${childPid}) affiche son message stdout.`,
              activePid: childPid,
              line: condLine,
              outputLine: out,
              processes: cloneProcesses(),
            });
          }
          if (condText.includes("exit")) {
            processes[childPid]!.state = "ZOMBIE";
            processes[childPid]!.exitCode = 0;
            processes[childPid]!.endedAtStep = stepIndex;
            zombieQueue.push(childPid);

            steps.push({
              stepIndex: stepIndex++,
              title: `${childName} : exit(0)`,
              explanation: `Le ${childName} devient ZOMBIE en attente du wait du père.`,
              activePid: childPid,
              line: condLine,
              processes: cloneProcesses(),
            });
          }
        }

        i++; // skip condition line in main loop
      }

      continue;
    }

    // 2. Detect printf in main()
    if (trimmed.includes("printf")) {
      const out = interpolatePrintf(trimmed, rootPid, null);
      processes[rootPid]!.currentLine = lineNum;
      processes[rootPid]!.codeSnippet = "printf()";

      steps.push({
        stepIndex: stepIndex++,
        title: "printf() dans le père",
        explanation: `Le processus père (PID ${rootPid}) affiche sur la sortie standard.`,
        activePid: rootPid,
        line: lineNum,
        outputLine: out,
        processes: cloneProcesses(),
      });
      continue;
    }

    // 3. Detect sleep in main()
    if (/\bsleep\s*\(\s*(\d+)\s*\)/.test(trimmed)) {
      const secMatch = trimmed.match(/\bsleep\s*\(\s*(\d+)\s*\)/);
      const sec = secMatch ? secMatch[1] : "1";
      processes[rootPid]!.state = "SLEEPING";
      processes[rootPid]!.currentLine = lineNum;

      steps.push({
        stepIndex: stepIndex++,
        title: `Père : sleep(${sec})`,
        explanation: `Le processus père (PID ${rootPid}) s'endort pendant ${sec}s.`,
        activePid: rootPid,
        line: lineNum,
        processes: cloneProcesses(),
      });
      processes[rootPid]!.state = "RUNNING";
      continue;
    }

    // 4. Detect wait(0) or wait(NULL) in main()
    if (/\bwait\s*\([^)]*\)/.test(trimmed)) {
      const zombiePid = zombieQueue.shift();
      if (zombiePid && processes[zombiePid]) {
        processes[zombiePid]!.state = "TERMINATED";
        processes[rootPid]!.currentLine = lineNum;
        processes[rootPid]!.codeSnippet = `wait() -> ${zombiePid}`;

        const zName = processes[zombiePid]!.name;
        steps.push({
          stepIndex: stepIndex++,
          title: `wait() : Récupération de ${zName}`,
          explanation: `Le père (PID ${rootPid}) appelle wait(). Le processus ${zName} (PID ${zombiePid}) est acquitté et libéré (état TERMINATED).`,
          activePid: rootPid,
          line: lineNum,
          processes: cloneProcesses(),
        });
      } else {
        // Wait when no child is ready
        steps.push({
          stepIndex: stepIndex++,
          title: "wait() : Attente d'un processus fils",
          explanation: `Le père (PID ${rootPid}) attend la terminaison d'un fils avec wait().`,
          activePid: rootPid,
          line: lineNum,
          processes: cloneProcesses(),
        });
      }
      continue;
    }

    // 5. Detect function call in main (like p())
    const funcCallMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)\s*;/);
    if (funcCallMatch && funcCallMatch[1]) {
      const fName = funcCallMatch[1];
      const fn = functions.get(fName);
      if (fn) {
        steps.push({
          stepIndex: stepIndex++,
          title: `Appel de ${fName}() par le père`,
          explanation: `Le processus père (PID ${rootPid}) exécute sa fonction ${fName}().`,
          activePid: rootPid,
          line: lineNum,
          processes: cloneProcesses(),
        });

        for (const fnLine of fn.lines) {
          const fTrim = fnLine.text.trim();
          if (fTrim.includes("printf")) {
            const out = interpolatePrintf(fTrim, rootPid, null);
            processes[rootPid]!.currentLine = fnLine.lineNum;
            steps.push({
              stepIndex: stepIndex++,
              title: `${fName}() : printf()`,
              explanation: `Le père affiche depuis ${fName}().`,
              activePid: rootPid,
              line: fnLine.lineNum,
              outputLine: out,
              processes: cloneProcesses(),
            });
          }
        }
      }
      continue;
    }

    // 6. Detect return 0 or exit
    if (trimmed.includes("return") || trimmed.includes("exit")) {
      processes[rootPid]!.currentLine = lineNum;
      processes[rootPid]!.state = "TERMINATED";
      processes[rootPid]!.exitCode = 0;
      processes[rootPid]!.endedAtStep = stepIndex;

      steps.push({
        stepIndex: stepIndex++,
        title: "Fin du programme main()",
        explanation: `Le processus père (PID ${rootPid}) termine son exécution avec succès (code 0).`,
        activePid: rootPid,
        line: lineNum,
        processes: cloneProcesses(),
      });
      break;
    }
  }

  // Ensure last step marks parent terminated if not already
  if (processes[rootPid]!.state !== "TERMINATED") {
    processes[rootPid]!.state = "TERMINATED";
    processes[rootPid]!.exitCode = 0;
    processes[rootPid]!.endedAtStep = stepIndex;

    steps.push({
      stepIndex: stepIndex++,
      title: "Fin d'exécution",
      explanation: "Tous les processus ont terminé leur exécution.",
      activePid: rootPid,
      line: mainFunc?.endLine ?? rawLines.length,
      processes: cloneProcesses(),
    });
  }

  return {
    id: `custom-${Date.now()}`,
    title: fileName,
    fileName,
    code: sourceCode,
    steps,
    isCustom: true,
    forkCount: totalForks,
  };
}
