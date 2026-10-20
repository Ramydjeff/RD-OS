// Built-in example programs. Every trace is computed by the engine from the
// code itself: nothing is hard-coded, so editing an example changes the result.

export interface SimExample {
  id: string;
  title: string;
  desc: string;
  fileName: string;
  code: string;
}

const HEADERS = `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
`;

export const SIM_EXAMPLES: SimExample[] = [
  {
    id: "ex-2forks",
    title: "2 forks (TD)",
    desc: "Deux fils p1() et p2(), le père appelle p() puis deux wait()",
    fileName: "2_forks_wait.c",
    code: `${HEADERS}
void p() {
    printf("je suis le processus pere %d\\n", getpid());
}

void p1() {
    printf("je suis le processus fils 1 %d\\n", getpid());
    exit(0);
}

void p2() {
    printf("je suis le processus fils 2 %d\\n", getpid());
    exit(0);
}

int main() {
    printf("salam WAALIKOM\\n");
    int id = fork();
    if (id == 0) { p1(); }
    id = fork();
    if (id == 0) { p2(); }
    p();
    wait(0);
    wait(0);
    return 0;
}
`,
  },
  {
    id: "ex-loop",
    title: "Boucle de forks",
    desc: "n-1 fils créés dans une boucle, chacun appelle pfils(i)",
    fileName: "boucle_forks.c",
    code: `${HEADERS}
int n = 5;

void p() {
    printf("je suis le processus pere %d\\n", getpid());
}

void pfils(int i) {
    printf("je suis le processus fils %d (PID %d)\\n", i, getpid());
    exit(0);
}

int main() {
    printf("salam\\n");
    for (int i = 2; i <= n; i++) {
        int id = fork();
        if (id == 0) {
            pfils(i);
        }
    }
    p();
    for (int i = 2; i <= n; i++) {
        wait(0);
    }
    return 0;
}
`,
  },
  {
    id: "ex-cascade",
    title: "fork() en cascade (2ⁿ)",
    desc: "Sans exit dans la boucle : chaque fils refait des fork()",
    fileName: "cascade.c",
    code: `${HEADERS}
int main() {
    for (int i = 0; i < 3; i++) {
        fork();
    }
    printf("PID %d (pere %d)\\n", getpid(), getppid());
    while (wait(NULL) > 0);
    return 0;
}
`,
  },
  {
    id: "ex-chain",
    title: "Père → fils → petit-fils",
    desc: "Arborescence sur trois générations avec wait() imbriqués",
    fileName: "chaine_processus.c",
    code: `${HEADERS}
int main() {
    printf("[Pere %d] Demarrage\\n", getpid());
    pid_t f1 = fork();
    if (f1 == 0) {
        printf("[Fils %d] Je cree le petit-fils...\\n", getpid());
        pid_t f2 = fork();
        if (f2 == 0) {
            printf("[Petit-fils %d] Troisieme generation, mon pere est %d\\n", getpid(), getppid());
            exit(0);
        }
        wait(NULL);
        printf("[Fils %d] Petit-fils termine, je quitte.\\n", getpid());
        exit(0);
    }
    wait(NULL);
    printf("[Pere %d] Fin du programme.\\n", getpid());
    return 0;
}
`,
  },
  {
    id: "ex-sleep",
    title: "sleep() & wait()",
    desc: "Le fils dort 2 s, le père se bloque dans wait() et lit le code de sortie",
    fileName: "sleep_wait.c",
    code: `${HEADERS}
int main() {
    printf("[Pere %d] Demarrage\\n", getpid());
    pid_t pid = fork();
    if (pid == 0) {
        printf("[Fils %d] Je dors 2 secondes (PPID=%d)\\n", getpid(), getppid());
        sleep(2);
        printf("[Fils %d] Reveil et exit(3)\\n", getpid());
        exit(3);
    }
    printf("[Pere %d] Fils %d cree, attente avec wait()...\\n", getpid(), pid);
    int status;
    wait(&status);
    if (WIFEXITED(status)) {
        printf("[Pere %d] Fils termine avec le code %d\\n", getpid(), WEXITSTATUS(status));
    }
    return 0;
}
`,
  },
  {
    id: "ex-buffer",
    title: "Tampon stdout & fork",
    desc: "printf sans \\n avant fork() : le texte s'affiche deux fois",
    fileName: "tampon_fork.c",
    code: `${HEADERS}
int main() {
    printf("Bonjour ");          /* pas de \\n : reste dans le tampon */
    pid_t pid = fork();          /* le tampon est copie dans le fils */
    if (pid == 0) {
        printf("du fils\\n");
        exit(0);
    }
    wait(NULL);
    printf("du pere\\n");
    return 0;
}
`,
  },
  {
    id: "ex-zombie",
    title: "Zombie & orphelin",
    desc: "Un fils reste zombie, un autre devient orphelin adopté par init",
    fileName: "zombie_orphelin.c",
    code: `${HEADERS}
int main() {
    pid_t z = fork();
    if (z == 0) {
        printf("[Z %d] je termine tout de suite\\n", getpid());
        exit(0);                 /* zombie tant que le pere ne fait pas wait */
    }
    pid_t o = fork();
    if (o == 0) {
        sleep(2);                /* le pere sera mort a mon reveil */
        printf("[O %d] orphelin, mon nouveau pere est %d\\n", getpid(), getppid());
        exit(0);
    }
    sleep(1);
    printf("[Pere] je recupere le zombie %d\\n", waitpid(z, NULL, 0));
    printf("[Pere] je termine sans attendre %d\\n", o);
    return 0;
}
`,
  },
  {
    id: "ex-pipe",
    title: "Tube père → fils",
    desc: "pipe(), fork(), close() des extrémités inutiles, read() jusqu'à EOF",
    fileName: "tube.c",
    code: `${HEADERS}#include <string.h>

int main() {
    int fd[2];
    char buf[32];
    pipe(fd);
    pid_t pid = fork();
    if (pid == 0) {
        close(fd[1]);            /* le fils ne fait que lire */
        int n;
        while ((n = read(fd[0], buf, sizeof(buf) - 1)) > 0) {
            buf[n] = '\\0';
            printf("[Fils] recu : %s\\n", buf);
        }
        close(fd[0]);
        exit(0);
    }
    close(fd[0]);                /* le pere ne fait qu'ecrire */
    char *msg = "salut fils";
    write(fd[1], msg, strlen(msg));
    close(fd[1]);                /* EOF pour le fils */
    wait(NULL);
    printf("[Pere] fin\\n");
    return 0;
}
`,
  },
  {
    id: "ex-signal",
    title: "Signaux (kill, handler)",
    desc: "SIGUSR1 capturé par un gestionnaire, puis SIGKILL",
    fileName: "signaux.c",
    code: `${HEADERS}#include <signal.h>

void handler(int sig) {
    printf("[Fils %d] signal %d recu\\n", getpid(), sig);
}

int main() {
    pid_t pid = fork();
    if (pid == 0) {
        signal(SIGUSR1, handler);
        while (1) {
            pause();
        }
    }
    sleep(1);
    kill(pid, SIGUSR1);
    sleep(1);
    kill(pid, SIGKILL);
    int st;
    wait(&st);
    if (WIFSIGNALED(st)) printf("[Pere] fils tue par le signal %d\\n", WTERMSIG(st));
    return 0;
}
`,
  },
  {
    id: "ex-exec",
    title: "exec & redirection",
    desc: "dup2() vers un tube puis execlp(\"wc\") : ls | wc -l en C",
    fileName: "exec_wc.c",
    code: `${HEADERS}
int main() {
    int fd[2];
    pipe(fd);
    if (fork() == 0) {
        dup2(fd[1], 1);          /* stdout -> tube */
        close(fd[0]); close(fd[1]);
        execlp("ls", "ls", NULL);
        perror("execlp ls");
        exit(1);
    }
    if (fork() == 0) {
        dup2(fd[0], 0);          /* stdin <- tube */
        close(fd[0]); close(fd[1]);
        execlp("wc", "wc", "-l", NULL);
        perror("execlp wc");
        exit(1);
    }
    close(fd[0]); close(fd[1]);
    wait(NULL);
    wait(NULL);
    printf("ls | wc -l termine\\n");
    return 0;
}
`,
  },
];

export const DEFAULT_EXAMPLE = SIM_EXAMPLES[0]!;
