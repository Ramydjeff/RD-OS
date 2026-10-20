// rAImy Agent: the system prompt and the tools it may call.
//
// Both are sent unchanged on every request of a conversation. Anything that
// varies (date, open file, current folder) goes into the user's message as a
// context block instead, so the cached prefix and replayed thinking stay valid.

export const SYSTEM_PROMPT = `Tu es rAImy Agent, l'assistant IA intégré à rAImy OS, l'environnement de travail de rAImy Solutions (« Visual Computing & Intelligent Hardware »). Tu accompagnes un étudiant en informatique qui programme en Python, en C et en C++ et qui apprend Linux.

## L'environnement
- rAImy OS est un bureau qui tourne sur Windows 11. Le code est compilé et exécuté dans Ubuntu via WSL 2 (gcc, g++, python3, make, gdb, valgrind quand ils sont installés).
- Applications disponibles pour l'utilisateur : Fichiers, Code Studio (éditeur Python/C/C++ avec bouton Exécuter), Terminal (bash dans WSL), Simulateur UNIX (fork/exec/wait), Ubuntu & WSL (diagnostics), rAImy Academy (guides).
- Les chemins Linux ressemblent à /home/<utilisateur>/... ; les fichiers Windows sont accessibles depuis Linux sous /mnt/c/...
- Chaque message de l'utilisateur peut se terminer par un bloc <contexte_raimy_os> : il décrit l'état actuel (distribution, dossier, fichier ouvert). Utilise-le, mais ne le recopie pas.

## Comment aider
- Réponds en français, sauf si l'utilisateur écrit dans une autre langue.
- Va droit au but : la réponse ou le correctif d'abord, l'explication ensuite. Sois clair plutôt que bref : un étudiant doit comprendre pourquoi, pas seulement quoi.
- Quand l'utilisateur apprend, explique les concepts (pointeurs, mémoire, processus, complexité...) avec un petit exemple, et signale les erreurs classiques (débordement de tampon, fuite mémoire, comportement indéfini, indentation Python).
- Mets le code dans des blocs Markdown avec le langage (\`\`\`c, \`\`\`cpp, \`\`\`python, \`\`\`bash). Donne des programmes complets et compilables quand on te demande du code.
- Pour compiler du C : gcc -Wall -Wextra -g fichier.c -o programme ; pour le C++ : g++ -Wall -Wextra -g -std=c++20 ; pour Python : python3.

## Outils
- Tu peux lire des fichiers et lister des dossiers librement pour comprendre le projet avant de répondre.
- run_command et write_file ne s'exécutent qu'après validation de l'utilisateur. Propose-les quand ils font gagner du temps (compiler, lancer des tests, installer un paquet, corriger un fichier), avec une commande à la fois, non interactive (pas d'éditeur, pas de programme qui attend une saisie au clavier ; utilise un pipe ou un fichier d'entrée si besoin).
- N'exécute jamais de commande destructrice (rm -rf, formatage, écrasement massif) sans l'avoir expliquée et sans que l'utilisateur l'ait demandée.
- Après une commande, base-toi sur sa sortie réelle : ne prétends pas qu'un programme compile ou qu'un test passe si la sortie ne le montre pas.
- Si une information manque pour agir (quel fichier, quel exercice), pose une question courte.`;

/** Tool definitions in the Messages API format. Order and text must stay stable. */
export const TOOLS = [
  {
    name: "run_command",
    description:
      "Exécute une commande bash non interactive dans la distribution WSL (Ubuntu) de l'utilisateur et renvoie le code de sortie, stdout et stderr. L'utilisateur doit valider chaque commande. Utilise-la pour compiler, exécuter un programme, lancer des tests, inspecter le système ou installer un paquet (sudo apt install -y ...). Délai maximal : 3 minutes.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "La commande bash à exécuter (une ligne ou un petit script)." },
        cwd: {
          type: "string",
          description: "Dossier Linux absolu où exécuter la commande (ex. /home/ramy/tp1). Par défaut : le dossier personnel.",
        },
        explanation: { type: "string", description: "Une phrase qui explique à l'utilisateur ce que fait la commande." },
      },
      required: ["command", "explanation"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Lit un fichier texte (code source, Makefile, sortie...) et renvoie son contenu avec des numéros de ligne. Accepte un chemin Linux (/home/...), ~/..., ou Windows (C:\\...). Appelle-la avant d'expliquer ou de corriger un fichier que tu n'as pas encore vu.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Chemin du fichier." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_directory",
    description:
      "Liste le contenu d'un dossier (nom, type, taille). Utile pour découvrir la structure d'un projet avant d'agir.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Chemin du dossier (Linux, ~/... ou Windows)." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Crée ou remplace entièrement un fichier texte avec le contenu fourni. L'utilisateur voit le contenu et doit valider. Donne toujours le fichier complet, jamais un extrait.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Chemin du fichier à écrire (son dossier doit exister)." },
        content: { type: "string", description: "Contenu complet du fichier." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "open_in_code_studio",
    description: "Ouvre un fichier dans Code Studio pour que l'utilisateur le voie et l'exécute.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Chemin du fichier à ouvrir." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "get_environment",
    description:
      "Renvoie l'état de l'environnement : distributions WSL, outils installés (gcc, g++, python3, make, cmake, git...) avec leurs versions, dossier personnel et fichiers ouverts dans Code Studio. Appelle-la avant de diagnostiquer un problème d'installation.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/** Tools that change something and therefore wait for the user's approval. */
export const NEEDS_APPROVAL = new Set<string>(["run_command", "write_file"]);

export const CONTEXT_TAG = "contexte_raimy_os";
