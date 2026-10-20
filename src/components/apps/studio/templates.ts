// Starter files for "Nouveau" in Code Studio and on the desktop.

export interface Template {
  id: string;
  label: string;
  fileName: string;
  content: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "python",
    label: "Python",
    fileName: "main.py",
    content: `def main() -> None:
    nom = input("Comment t'appelles-tu ? ")
    print(f"Bonjour {nom}, bienvenue sur rAImy OS !")


if __name__ == "__main__":
    main()
`,
  },
  {
    id: "c",
    label: "C",
    fileName: "main.c",
    content: `#include <stdio.h>

int main(void) {
    int n;
    printf("Entrez un entier : ");
    if (scanf("%d", &n) != 1) {
        fprintf(stderr, "Ce n'est pas un entier.\\n");
        return 1;
    }
    printf("%d au carré = %d\\n", n, n * n);
    return 0;
}
`,
  },
  {
    id: "cpp",
    label: "C++",
    fileName: "main.cpp",
    content: `#include <iostream>
#include <string>
#include <vector>

int main() {
    std::vector<std::string> langages{"C", "C++", "Python"};
    for (const auto& l : langages) {
        std::cout << "J'apprends le " << l << " avec rAImy OS\\n";
    }
    return 0;
}
`,
  },
  {
    id: "c-fork",
    label: "C — processus (fork/wait)",
    fileName: "processus.c",
    content: `#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return EXIT_FAILURE;
    }
    if (pid == 0) {
        printf("Enfant : PID=%d, parent=%d\\n", getpid(), getppid());
        return EXIT_SUCCESS;
    }
    int status;
    waitpid(pid, &status, 0);
    printf("Parent : PID=%d, l'enfant %d s'est terminé (code %d)\\n", getpid(), pid, WEXITSTATUS(status));
    return EXIT_SUCCESS;
}
`,
  },
  {
    id: "shell",
    label: "Script Bash",
    fileName: "script.sh",
    content: `#!/usr/bin/env bash
set -euo pipefail

echo "Utilisateur : $(whoami)"
echo "Dossier     : $(pwd)"
echo "Système     : $(uname -sr)"
`,
  },
];

export function templateFor(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
