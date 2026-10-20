// Linux signal numbers, default actions and errno values (x86-64).

export const SIG = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGCHLD: 17,
  SIGCONT: 18,
  SIGSTOP: 19,
  SIGTSTP: 20,
} as const;

export const ERRNO = {
  EPERM: 1,
  ENOENT: 2,
  ESRCH: 3,
  EINTR: 4,
  EBADF: 9,
  ECHILD: 10,
  EAGAIN: 11,
  ENOMEM: 12,
  EINVAL: 22,
  EMFILE: 24,
  EPIPE: 32,
} as const;

const ERRNO_TEXT: Record<number, string> = {
  0: "Success",
  1: "Operation not permitted",
  2: "No such file or directory",
  3: "No such process",
  4: "Interrupted system call",
  9: "Bad file descriptor",
  10: "No child processes",
  11: "Resource temporarily unavailable",
  12: "Cannot allocate memory",
  22: "Invalid argument",
  24: "Too many open files",
  32: "Broken pipe",
};

export function errnoText(n: number): string {
  return ERRNO_TEXT[n] ?? `Unknown error ${n}`;
}

export function signalName(n: number): string {
  for (const [name, v] of Object.entries(SIG)) if (v === n) return name;
  return `signal ${n}`;
}

export type SigAction = "term" | "core" | "ign" | "stop" | "cont";

export function defaultAction(sig: number): SigAction {
  switch (sig) {
    case SIG.SIGCHLD:
      return "ign";
    case SIG.SIGCONT:
      return "cont";
    case SIG.SIGSTOP:
    case SIG.SIGTSTP:
      return "stop";
    case SIG.SIGQUIT:
    case SIG.SIGILL:
    case SIG.SIGTRAP:
    case SIG.SIGABRT:
    case SIG.SIGBUS:
    case SIG.SIGFPE:
    case SIG.SIGSEGV:
      return "core";
    default:
      return "term";
  }
}

/** Message bash prints when the foreground job dies from a signal (French locale). */
export function shellSignalMessage(sig: number, core: boolean): string {
  const base: Record<number, string> = {
    [SIG.SIGSEGV]: "Erreur de segmentation",
    [SIG.SIGFPE]: "Exception en point flottant",
    [SIG.SIGABRT]: "Abandon",
    [SIG.SIGKILL]: "Processus arrêté",
    [SIG.SIGTERM]: "Complété",
    [SIG.SIGINT]: "",
    [SIG.SIGPIPE]: "",
    [SIG.SIGALRM]: "Minuterie d'alerte",
    [SIG.SIGUSR1]: "Signal 1 défini par l'usager",
    [SIG.SIGUSR2]: "Signal 2 défini par l'usager",
    [SIG.SIGHUP]: "Raccrocher (hangup)",
    [SIG.SIGQUIT]: "Quitter",
  };
  const m = base[sig] ?? signalName(sig);
  if (!m) return "";
  return core ? `${m} (core dumped)` : m;
}
