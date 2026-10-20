// Expected outputs were produced by gcc 15 / glibc in WSL (stdout line-buffered).

import { simulate, terminalText, type SimOptions } from "./index";

const H = "#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <signal.h>\n#include <string.h>\n#include <sys/wait.h>\n";

function run(body: string, opts: Partial<SimOptions> = {}) {
  const r = simulate(H + body, "test.c", opts);
  return { r, out: terminalText(r) };
}

const sortedLines = (s: string) => s.split("\n").filter(Boolean).sort();

describe("moteur C : processus", () => {
  it("deux fork() avec fonctions : sortie, zombies et ordre des wait()", () => {
    const { r, out } = run(`
void p(){ printf("pere %d\\n", getpid()); }
void p1(){ printf("fils 1 %d\\n", getpid()); exit(0); }
void p2(){ printf("fils 2 %d\\n", getpid()); exit(0); }
int main(){
    printf("salam\\n");
    int id = fork();
    if (id == 0) { p1(); }
    id = fork();
    if (id == 0) { p2(); }
    p();
    wait(0);
    wait(0);
    return 0;
}`);
    expect(r.ok).toBe(true);
    expect(out).toBe("salam\npere 2001\nfils 1 2002\nfils 2 2003\n");
    expect(r.stats.processes).toBe(3);
    expect(r.stats.zombies).toBe(2);
    const reaps = r.steps.filter((s) => s.kind === "reap").map((s) => s.marks.find((m) => m.type === "reap"));
    expect(reaps).toEqual([
      { type: "reap", parent: 2001, child: 2002 },
      { type: "reap", parent: 2001, child: 2003 },
    ]);
    const last = r.steps[r.steps.length - 1]!;
    expect(last.procs.every((p) => p.state === "TERMINATED")).toBe(true);
  });

  it("fork() dans une boucle crée 2^n processus", () => {
    const { r, out } = run(`int main(){ for (int i = 0; i < 3; i++) fork(); printf("x\\n"); while (wait(NULL) > 0); return 0; }`);
    expect(r.stats.processes).toBe(8);
    expect(out).toBe("x\n".repeat(8));
    const labels = r.steps[r.steps.length - 1]!.procs.map((p) => p.short);
    expect(labels).toContain("F1.1.1");
  });

  it("court-circuit fork() && fork()", () => {
    const { out } = run(`int main(){ if (fork() && fork()) printf("A\\n"); else printf("B\\n"); while (wait(NULL) > 0); return 0; }`);
    expect(sortedLines(out)).toEqual(["A", "B", "B"]);
  });

  it("le fils a une copie de la mémoire (globale et locale)", () => {
    const { out } = run(`
int g = 10;
int main() {
    int local = 1;
    pid_t pid = fork();
    if (pid == 0) { g += 5; local = 99; printf("fils: g=%d local=%d\\n", g, local); exit(7); }
    int st;
    waitpid(pid, &st, 0);
    printf("pere: g=%d local=%d exit=%d\\n", g, local, WEXITSTATUS(st));
    return 0;
}`);
    expect(out).toBe("fils: g=15 local=99\npere: g=10 local=1 exit=7\n");
  });

  it("tampon stdout dupliqué par fork() et perdu par _exit()", () => {
    const dup = run(`int main(){ printf("hello "); fork(); printf("world\\n"); while (wait(NULL) > 0); return 0; }`);
    expect(dup.out).toBe("hello world\nhello world\n");
    expect(dup.r.warnings.some((w) => w.message.includes("tampon de stdout"))).toBe(true);
    const lost = run(`int main(){
    printf("A");
    if (fork() == 0) { printf("B"); exit(0); }
    wait(NULL);
    printf("C");
    if (fork() == 0) { printf("D"); _exit(0); }
    wait(NULL);
    printf("\\n");
    return 0;
}`);
    expect(lost.out).toBe("ABAC\n");
  });

  it("petit-fils, wait() bloquant et réveil du père", () => {
    const { r, out } = run(`int main() {
    printf("P\\n");
    if (fork() == 0) {
        if (fork() == 0) { printf("PF\\n"); exit(0); }
        wait(NULL);
        printf("F\\n");
        exit(0);
    }
    wait(NULL);
    printf("fin\\n");
    return 0;
}`);
    expect(out).toBe("P\nPF\nF\nfin\n");
    const end = r.steps[r.steps.length - 1]!;
    const grandChild = end.procs.find((p) => p.short === "F1.1")!;
    expect(grandChild.parent).toBe(2002);
    expect(r.steps.some((s) => s.kind === "block")).toBe(true);
  });

  it("orphelin adopté par init", () => {
    const { r, out } = run(`int main() {
    if (fork() == 0) { sleep(1); printf("ppid=%d\\n", getppid()); return 0; }
    printf("pere termine\\n");
    return 0;
}`);
    expect(out).toBe("pere termine\nppid=1\n");
    expect(r.stats.orphans).toBe(1);
    expect(r.output.some((c) => c.stream === "sys" && c.text.includes("$"))).toBe(true);
  });

  it("codes de sortie sur 8 bits et SIGFPE", () => {
    const { out } = run(`int main() {
    int codes[3] = {0, 255, 256};
    for (int i = 0; i < 3; i++) {
        if (fork() == 0) exit(codes[i]);
        int st; wait(&st);
        printf("exit(%d) -> %d\\n", codes[i], WEXITSTATUS(st));
    }
    if (fork() == 0) { int z = 0; int y = 5 / z; printf("%d\\n", y); exit(0); }
    int st; wait(&st);
    printf("signaled=%d sig=%d\\n", WIFSIGNALED(st), WTERMSIG(st));
    return 0;
}`);
    expect(out).toBe("exit(0) -> 0\nexit(255) -> 255\nexit(256) -> 0\nsignaled=1 sig=8\n");
  });

  it("waitpid WNOHANG puis ECHILD", () => {
    const { out } = run(`int main() {
    pid_t a = fork();
    if (a == 0) { exit(2); }
    sleep(1);
    int st;
    pid_t r = waitpid(-1, &st, WNOHANG);
    printf("r==a:%d code=%d\\n", r == a, WEXITSTATUS(st));
    r = waitpid(-1, &st, WNOHANG);
    printf("r=%d\\n", r);
    printf("wait sans fils: %d\\n", wait(NULL));
    return 0;
}`);
    expect(out).toBe("r==a:1 code=2\nr=-1\nwait sans fils: -1\n");
  });
});

describe("moteur C : tubes, exec et signaux", () => {
  it("tube + dup2 + execlp(wc -l)", () => {
    const { out } = run(`int main() {
    int fd[2];
    pipe(fd);
    if (fork() == 0) {
        dup2(fd[0], 0);
        close(fd[0]); close(fd[1]);
        execlp("wc", "wc", "-l", NULL);
        exit(1);
    }
    close(fd[0]);
    write(fd[1], "a\\nb\\nc\\n", 6);
    close(fd[1]);
    wait(NULL);
    printf("fin\\n");
    return 0;
}`);
    expect(out).toBe("3\nfin\n");
  });

  it("interblocage quand une extrémité d'écriture reste ouverte", () => {
    const { r } = run(`int main() {
    int fd[2]; char c;
    pipe(fd);
    if (fork() == 0) { while (read(fd[0], &c, 1) > 0) putchar(c); exit(0); }
    write(fd[1], "abc", 3);
    wait(NULL);
    return 0;
}`);
    expect(r.stats.deadlocked).toBe(2);
    expect(r.warnings.some((w) => w.message.includes("close()"))).toBe(true);
  });

  it("kill(SIGKILL) et WTERMSIG", () => {
    const { out } = run(`int main() {
    pid_t pid = fork();
    if (pid == 0) { while (1) { sleep(1); } }
    sleep(2);
    kill(pid, SIGKILL);
    int st;
    wait(&st);
    if (WIFSIGNALED(st)) printf("fils tue par le signal %d\\n", WTERMSIG(st));
    return 0;
}`);
    expect(out).toBe("fils tue par le signal 9\n");
  });

  it("gestionnaire de signal hérité et pause()", () => {
    const { out } = run(`int recu = 0;
void handler(int sig) { recu++; printf("handler: signal %d\\n", sig); }
int main() {
    signal(SIGUSR1, handler);
    pid_t pid = fork();
    if (pid == 0) { pause(); printf("fils: recu=%d\\n", recu); exit(0); }
    sleep(1);
    kill(pid, SIGUSR1);
    wait(NULL);
    printf("pere: recu=%d\\n", recu);
    return 0;
}`);
    expect(out).toBe("handler: signal 10\nfils: recu=1\npere: recu=0\n");
  });
});

describe("moteur C : langage", () => {
  it("printf identique à la glibc", () => {
    const { out } = run(`int main() {
    printf("[%5d][%-5d][%05d][%+d][% d]\\n", 42, 42, 42, 42, 42);
    printf("[%x][%X][%#x][%o][%#o]\\n", 255, 255, 255, 8, 8);
    printf("[%.2f][%8.3f][%-8.1f][%e][%E]\\n", 3.14159, 2.71828, -1.5, 12345.678, 0.000123);
    printf("[%g][%g][%g][%g][%.3g]\\n", 100000.0, 1000000.0, 0.0001, 0.00001, 3.14159);
    printf("[%c%c%c][%s][%10s][%-10s][%.3s]\\n", 'a', 66, '!', "abc", "right", "left", "truncate");
    printf("[%u][%ld][%lu][%%][%i]\\n", -1, 123456789012L, 4000000000UL, -17);
    return 0;
}`);
    expect(out).toBe(
      "[   42][42   ][00042][+42][ 42]\n" +
        "[ff][FF][0xff][10][010]\n" +
        "[3.14][   2.718][-1.5    ][1.234568e+04][1.230000E-04]\n" +
        "[100000][1e+06][0.0001][1e-05][3.14]\n" +
        "[aB!][abc][     right][left      ][tru]\n" +
        "[4294967295][123456789012][4000000000][%][-17]\n",
    );
  });

  it("arithmétique entière comme en C", () => {
    const { out } = run(`int main() {
    int a = -7, b = 2;
    printf("%d %d %d %d\\n", a / b, a % b, 7 / -2, 7 % -2);
    int big = 2147483647; big = big + 1; printf("%d\\n", big);
    unsigned int u = 0; u = u - 1; printf("%u\\n", u);
    char c = 200; printf("%d\\n", c);
    double d = 7 / 2; printf("%.1f %.2f\\n", d, 7 / 2.0);
    long l = 100000L * 100000L; printf("%ld\\n", l);
    return 0;
}`);
    expect(out).toBe("-3 -1 -3 1\n-2147483648\n4294967295\n-56\n3.0 3.50\n10000000000\n");
  });

  it("contrôle, récursion, static, switch", () => {
    const { out } = run(`int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int counter() { static int c = 0; c++; return c; }
int main() {
    for (int i = 0; i < 6; i++) { if (i == 1) continue; if (i == 4) break; printf("i=%d ", i); }
    printf("\\n");
    for (int v = 0; v < 4; v++) {
        switch (v) { case 0: printf("zero "); case 1: printf("un "); break; case 2: printf("deux "); break; default: printf("autre "); }
    }
    printf("\\n%d %d\\n", fact(5), fact(10));
    counter(); counter();
    printf("counter=%d\\n", counter());
    return 0;
}`);
    expect(out).toBe("i=0 i=2 i=3 \nzero un un deux autre \n120 3628800\ncounter=3\n");
  });

  it("tableaux, chaînes, macros et malloc", () => {
    const { out } = run(`#define N 5
#define CARRE(x) ((x) * (x))
int main() {
    int t[N] = {5, 3, 9};
    int m[2][3] = {{1, 2, 3}, {4, 5, 6}};
    int s = 0;
    for (int i = 0; i < N; i++) s += t[i];
    printf("somme=%d taille=%lu\\n", s, sizeof(t) / sizeof(t[0]));
    printf("m[1][2]=%d CARRE(3+1)=%d\\n", m[1][2], CARRE(3 + 1));
    char nom[20] = "Ramy";
    strcat(nom, " OS");
    printf("%s (%lu)\\n", nom, strlen(nom));
    int *p = malloc(4 * sizeof(int));
    for (int i = 0; i < 4; i++) p[i] = i * i;
    int *q = p + 2;
    printf("%d %d %d\\n", *q, q[1], *(p + 1));
    free(p);
    return 0;
}`);
    expect(out).toBe("somme=17 taille=5\nm[1][2]=6 CARRE(3+1)=16\nRamy OS (7)\n4 9 1\n");
  });

  it("rand() reproduit la glibc et l'ordre d'évaluation de gcc", () => {
    const { out } = run(`int main() {
    printf("%d %d %d\\n", rand(), rand(), rand());
    srand(42);
    printf("%d %d\\n", rand() % 100, rand() % 100);
    return 0;
}`);
    expect(out).toBe("1681692777 846930886 1804289383\n40 66\n");
  });

  it("scanf lit l'entrée standard simulée", () => {
    const { out } = run(`int main() { int a, b; printf("? "); int n = scanf("%d %d", &a, &b); printf("n=%d s=%d\\n", n, a + b); return 0; }`, {
      stdin: "3 4\n",
    });
    expect(out).toBe("? n=2 s=7\n");
  });
});

describe("moteur C : ordonnancement et erreurs", () => {
  const prog = `int main() {
    if (fork() == 0) { for (int i = 0; i < 2; i++) printf("f%d\\n", i); exit(0); }
    for (int i = 0; i < 2; i++) printf("p%d\\n", i);
    wait(NULL);
    return 0;
}`;

  it("politiques père d'abord, fils d'abord et tourniquet", () => {
    expect(run(prog, { policy: "parent" }).out).toBe("p0\np1\nf0\nf1\n");
    expect(run(prog, { policy: "child" }).out).toBe("f0\nf1\np0\np1\n");
    expect(run(prog, { policy: "rr", quantum: 2 }).out).toBe("p0\nf0\np1\nf1\n");
  });

  it("limite les fork bombs et les boucles infinies", () => {
    const { r } = run(`int main() { while (1) { fork(); } return 0; }`, { maxSteps: 800 });
    expect(r.stats.truncated).toBe(true);
    expect(r.stats.processes).toBeLessThanOrEqual(40);
  });

  it("erreurs de compilation avec la bonne ligne", () => {
    const missing = simulate("int main() {\n    int x = 5\n    return x;\n}\n");
    expect(missing.ok).toBe(false);
    expect(missing.error?.line).toBe(2);
    expect(missing.error?.message).toContain("Point-virgule");
    const undeclared = simulate("#include <stdio.h>\nint main() {\n    printf(\"%d\", y);\n    foo();\n    return 0;\n}\n");
    expect(undeclared.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it("signale un #include manquant comme gcc", () => {
    const r = simulate("#include <stdio.h>\nint main() { if (fork() == 0) return 0; return 0; }\n");
    expect(r.warnings[0]?.message).toContain("unistd.h");
  });

  it("accès hors limites = SIGSEGV et message du shell", () => {
    const { r } = run(`int main() { int t[3] = {1, 2, 3}; printf("%d\\n", t[5]); return 0; }`);
    const root = r.steps[r.steps.length - 1]!.procs[0]!;
    expect(root.exitSignal).toBe(11);
    expect(terminalText(r, Infinity, true)).toContain("Erreur de segmentation");
  });
});
