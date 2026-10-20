// rAImy Academy: the built-in guides. Bodies are Markdown; ```bash blocks get
// an "Exécuter" button that types the command in the Ubuntu terminal.

export interface GuideSection {
  id: string;
  group: string;
  title: string;
  keywords: string;
  /** Live widget shown above the text. */
  widget?: "envcheck";
  body: string;
}

export const GUIDE: GuideSection[] = [
  {
    id: "bienvenue",
    group: "Démarrer",
    title: "Bienvenue dans rAImy OS",
    keywords: "accueil tour presentation decouvrir debut",
    body: `rAImy OS est votre poste de travail d'étudiant en informatique : un bureau complet qui réunit **Windows** pour vos applications habituelles et **Ubuntu** (via WSL 2) pour programmer comme les pros.

## Les applications
| Application | À quoi elle sert |
|---|---|
| **Fichiers** | Parcourir vos dossiers Windows (C:\\) et Linux (/home), ouvrir, renommer, exécuter |
| **Code Studio** | Écrire du Python, du C et du C++, puis compiler et exécuter en un clic |
| **Terminal** | Le shell bash d'Ubuntu, avec onglets et écrans partagés |
| **rAImy Agent** | L'assistant IA qui explique, corrige et agit dans votre environnement |
| **Applications** | Lancer vos programmes Windows (.exe) : VS Code, Chrome, Discord… |
| **Simulateur UNIX** | Visualiser fork, exec et wait pas à pas |
| **Ubuntu & WSL** | État des distributions Linux et des outils installés |
| **Moniteur** | Mémoire, processeur et sessions en cours |

## Vos trois premiers gestes
1. Vérifiez votre environnement dans **Installer les outils** (colonne de gauche) : tout doit être vert.
2. Ouvrez **Code Studio**, choisissez le modèle C, puis cliquez sur **Exécuter**.
3. Ouvrez **rAImy Agent** et demandez-lui : *« Explique-moi ce que fait ce programme »*.

## Gagner du temps
- **Ctrl + Maj + Espace** ouvre la recherche universelle : tapez le nom d'une app, d'un programme Windows, d'un fichier récent… ou \`$ ls -la\` pour lancer une commande.
- Glissez une fenêtre contre le bord gauche, droit ou haut de l'écran pour l'ancrer ou l'agrandir.
- Clic droit sur le bureau : nouveaux fichiers, fond d'écran, terminal.`,
  },
  {
    id: "installer-raimy",
    group: "Démarrer",
    title: "Télécharger et installer rAImy OS",
    keywords: "telecharger download installer installation setup exe build compiler mise a jour",
    body: `## Configuration requise
- Windows 10 (version 2004 ou plus récente) ou Windows 11, 64 bits
- 8 Go de RAM conseillés (WSL et Ubuntu en utilisent une partie)
- La virtualisation activée dans le BIOS (voir *Installer WSL 2 et Ubuntu*)
- Microsoft Edge WebView2 (déjà présent sur Windows 11)

## Installer depuis l'installateur
1. Téléchargez le fichier **rAImy Solutions_0.1.0_x64-setup.exe** fourni par rAImy Solutions.
2. Double-cliquez dessus. L'installation se fait pour votre compte uniquement : aucun droit administrateur n'est nécessaire.
3. Lancez **rAImy Solutions** depuis le menu Démarrer de Windows.

> Si Windows SmartScreen affiche « Windows a protégé votre ordinateur », cliquez sur *Informations complémentaires* puis *Exécuter quand même* : l'installateur n'est pas encore signé.

## Construire l'installateur soi-même
Il faut **Node.js 22**, **Rust** (via rustup) et les **outils de build Visual Studio** (charge de travail « Développement Desktop en C++»). Dans PowerShell, à la racine du projet :

\`\`\`powershell
npm install
npm run tauri build
\`\`\`

L'installateur est créé dans \`src-tauri\\target\\release\\bundle\\nsis\\\`. Pour développer avec rechargement à chaud :

\`\`\`powershell
npm run tauri dev
\`\`\`

## Où sont mes réglages ?
rAImy OS enregistre la disposition du bureau, les réglages et la clé de rAImy Agent dans \`%APPDATA%\\solutions.raimy.workspace\\\`. Désinstaller l'application depuis *Paramètres Windows → Applications* ne supprime pas vos fichiers de code.`,
  },
  {
    id: "installer-wsl",
    group: "Démarrer",
    title: "Installer WSL 2 et Ubuntu",
    keywords: "wsl ubuntu linux installer installation virtualisation bios distribution",
    body: `WSL 2 (*Windows Subsystem for Linux*) fait tourner un vrai noyau Linux dans Windows. rAImy OS s'en sert pour compiler et exécuter votre code.

## 1. Installer WSL et Ubuntu
Ouvrez **PowerShell en tant qu'administrateur** (clic droit sur le bouton Démarrer de Windows → *Terminal (administrateur)*), puis :

\`\`\`powershell
wsl --install -d Ubuntu-24.04
\`\`\`

Redémarrez l'ordinateur quand Windows le demande.

## 2. Créer votre compte Linux
Au premier lancement, Ubuntu demande un **nom d'utilisateur** (en minuscules, sans espace) et un **mot de passe**. Le mot de passe ne s'affiche pas pendant la saisie : c'est normal. Notez-le, il servira pour \`sudo\`.

## 3. Vérifier
\`\`\`powershell
wsl -l -v
\`\`\`
La colonne VERSION doit indiquer **2**. Sinon :
\`\`\`powershell
wsl --set-version Ubuntu-24.04 2
wsl --set-default-version 2
\`\`\`

## Si l'installation échoue
| Message | Solution |
|---|---|
| 0x80370102 / « la virtualisation n'est pas activée » | Activez *Intel VT-x* ou *AMD-V (SVM)* dans le BIOS/UEFI |
| 0x8007019e | Activez la fonctionnalité : \`wsl --install\` puis redémarrez |
| « WslRegisterDistribution failed » | \`wsl --update\` puis relancez Ubuntu |
| Ubuntu est très lent sur C:\\ | Travaillez dans /home/votre-nom (voir *Windows ↔ Linux*) |

Revenez ensuite dans rAImy OS : l'application **Ubuntu & WSL** doit afficher votre distribution en vert.`,
  },
  {
    id: "outils",
    group: "Démarrer",
    title: "Installer les outils de développement",
    keywords: "gcc g++ python pip make cmake gdb valgrind git outils build-essential apt installer verifier",
    widget: "envcheck",
    body: `Le tableau ci-dessus vérifie en direct ce qui est installé dans votre Ubuntu. Pour tout installer d'un coup (compilateurs C/C++, débogueur, Python, Git) :

\`\`\`bash
sudo apt update && sudo apt install -y build-essential gdb valgrind python3 python3-pip python3-venv git make cmake
\`\`\`

Le terminal demandera votre mot de passe Linux. Ensuite, vérifiez les versions :

\`\`\`bash
gcc --version && g++ --version && python3 --version
\`\`\`

## Ce que vous venez d'installer
| Paquet | Rôle |
|---|---|
| build-essential | gcc, g++, make et les en-têtes de la bibliothèque C |
| gdb | Le débogueur : exécution pas à pas, points d'arrêt |
| valgrind | Détecte les fuites mémoire et les accès invalides |
| python3-venv | Les environnements virtuels Python |
| cmake | Génère des projets C/C++ multi-fichiers |`,
  },
  {
    id: "ubuntu-bases",
    group: "Ubuntu",
    title: "Les commandes essentielles",
    keywords: "commandes bash shell ls cd pwd mkdir rm cp mv chmod sudo apt grep find man pipe redirection",
    body: `## Se déplacer
| Commande | Effet |
|---|---|
| \`pwd\` | Affiche le dossier courant |
| \`ls -la\` | Liste tout, avec les fichiers cachés et les droits |
| \`cd dossier\` · \`cd ..\` · \`cd ~\` | Entrer dans un dossier · remonter · revenir chez soi |

## Fichiers et dossiers
| Commande | Effet |
|---|---|
| \`mkdir -p tp1/src\` | Crée des dossiers (et les parents) |
| \`touch main.c\` | Crée un fichier vide |
| \`cp a.c b.c\` · \`mv a.c src/\` | Copier · déplacer ou renommer |
| \`rm fichier\` · \`rm -r dossier\` | Supprimer (définitif, pas de corbeille !) |
| \`cat f\` · \`less f\` | Afficher un fichier (q pour quitter less) |

## Droits et administration
- \`chmod +x script.sh\` rend un script exécutable, puis \`./script.sh\` le lance.
- \`sudo commande\` exécute en administrateur (mot de passe Linux).
- \`sudo apt install paquet\` installe un logiciel ; \`apt search mot\` en cherche un.

## Combiner les commandes
\`\`\`bash
ls -la | grep ".c"          # pipe : la sortie de ls devient l'entrée de grep
./programme > sortie.txt    # redirige la sortie dans un fichier
./programme < entree.txt    # lit l'entrée depuis un fichier
gcc main.c -o main && ./main  # && : la 2e commande seulement si la 1re réussit
\`\`\`

## Processus
\`ps aux\` liste les processus, \`top\` (ou \`htop\`) les montre en direct, \`kill PID\` en arrête un, **Ctrl+C** interrompt le programme en cours.

> Perdu ? \`man commande\` affiche le manuel, ou demandez à rAImy Agent : il peut lancer la commande pour vous montrer.`,
  },
  {
    id: "ubuntu-fichiers",
    group: "Ubuntu",
    title: "Windows ↔ Linux : où sont mes fichiers ?",
    keywords: "chemin mnt wsl.localhost explorer fichiers windows linux performance home",
    body: `Deux systèmes de fichiers cohabitent :

| Depuis | Fichiers Windows | Fichiers Linux |
|---|---|---|
| Linux (terminal) | \`/mnt/c/Users/vous/...\` | \`/home/votre-nom/...\` |
| Windows (Explorateur) | \`C:\\Users\\vous\\...\` | \`\\\\wsl.localhost\\Ubuntu-24.04\\home\\votre-nom\` |

L'application **Fichiers** de rAImy OS affiche les deux : *Accueil Linux* et les disques Windows sont dans la colonne de gauche.

## La règle d'or
**Rangez vos projets dans /home/votre-nom.** Compiler sur \`/mnt/c\` est 5 à 10 fois plus lent, et les droits Linux (chmod) y fonctionnent mal.

\`\`\`bash
mkdir -p ~/projets && cd ~/projets && explorer.exe .
\`\`\`

La dernière commande ouvre le dossier courant dans l'Explorateur Windows.`,
  },
  {
    id: "python",
    group: "Langages",
    title: "Python dans Ubuntu",
    keywords: "python pip venv environnement virtuel pdb script module",
    body: `## Exécuter un script
Dans Code Studio, ouvrez un fichier \`.py\` puis **Exécuter** (Ctrl+Entrée). Dans le terminal :
\`\`\`bash
python3 main.py
\`\`\`

## Un environnement virtuel par projet
Il isole les bibliothèques de chaque projet (et évite l'erreur *externally-managed-environment* de pip) :
\`\`\`bash
cd ~/projets/mon-projet
python3 -m venv .venv
source .venv/bin/activate
pip install requests numpy
\`\`\`
Tapez \`deactivate\` pour en sortir. Dans Code Studio, réglez l'interpréteur sur \`.venv/bin/python\` (bouton ⚙ de la barre d'outils).

## Déboguer
Le bouton **Déboguer** lance \`python3 -m pdb\` : \`n\` ligne suivante, \`s\` entrer dans une fonction, \`p variable\` afficher, \`c\` continuer, \`q\` quitter. Vous pouvez aussi écrire \`breakpoint()\` dans votre code.

## Erreurs fréquentes
| Erreur | Cause habituelle |
|---|---|
| IndentationError | Mélange d'espaces et de tabulations : Code Studio indente avec 4 espaces |
| ModuleNotFoundError | Bibliothèque non installée, ou venv non activé |
| NameError | Variable utilisée avant d'être définie, ou faute de frappe |`,
  },
  {
    id: "c",
    group: "Langages",
    title: "Programmer en C",
    keywords: "c gcc compiler warnings makefile gdb valgrind pointeur segmentation fault",
    body: `## Compiler et exécuter
Code Studio compile avec les bons réglages :
\`\`\`bash
gcc -Wall -Wextra -g -std=c17 main.c -o main -lm && ./main
\`\`\`
- \`-Wall -Wextra\` : tous les avertissements — lisez-les, ils annoncent souvent les bugs.
- \`-g\` : informations de débogage pour gdb et valgrind.
- \`-lm\` : bibliothèque mathématique (sqrt, pow…).

Les erreurs de compilation sont **surlignées en rouge** dans la marge de Code Studio.

## Plusieurs fichiers : un Makefile
\`\`\`make
CC = gcc
CFLAGS = -Wall -Wextra -g -std=c17

programme: main.o liste.o
	$(CC) $(CFLAGS) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) -c $<

clean:
	rm -f *.o programme
\`\`\`
Puis \`make\` pour compiler, \`make clean\` pour nettoyer.

## « Segmentation fault » ?
1. **Déboguer** lance gdb : tapez \`run\`, puis au crash \`bt\` pour voir la pile d'appels.
2. **Valgrind** signale les accès hors tableau, les pointeurs non initialisés et les fuites (\`malloc\` sans \`free\`).
3. Ou cliquez sur **Corriger** : rAImy Agent lit votre code et la sortie du terminal.`,
  },
  {
    id: "cpp",
    group: "Langages",
    title: "C++ moderne",
    keywords: "c++ cpp g++ stl vector string cmake classe",
    body: `## Compiler
\`\`\`bash
g++ -Wall -Wextra -g -std=c++20 main.cpp -o main && ./main
\`\`\`

## La bibliothèque standard d'abord
\`\`\`cpp
#include <algorithm>
#include <iostream>
#include <vector>

int main() {
    std::vector<int> notes{12, 17, 9, 15};
    std::sort(notes.begin(), notes.end());
    for (int n : notes) std::cout << n << ' ';
    std::cout << '\\n';
}
\`\`\`
Préférez \`std::vector\`, \`std::string\` et les pointeurs intelligents (\`std::unique_ptr\`) à \`new\`/\`delete\`.

## Projets plus grands : CMake
\`\`\`bash
mkdir build && cd build && cmake .. && make
\`\`\`
avec un \`CMakeLists.txt\` minimal :
\`\`\`cmake
cmake_minimum_required(VERSION 3.20)
project(MonProjet CXX)
set(CMAKE_CXX_STANDARD 20)
add_executable(app main.cpp)
\`\`\``,
  },
  {
    id: "processus",
    group: "Langages",
    title: "Processus UNIX : fork, exec, wait",
    keywords: "processus fork exec wait pid zombie orphelin systeme exploitation",
    body: `\`fork()\` duplique le processus : il renvoie **0 dans l'enfant** et **le PID de l'enfant dans le parent**. \`wait()\` fait attendre le parent ; \`exec*()\` remplace le programme du processus par un autre.

Dans Code Studio, choisissez **Nouveau → C — processus (fork/wait)** et exécutez-le.

Pour **voir** ce qui se passe (arbre des processus, états, zombies), ouvrez le **Simulateur UNIX** : il exécute votre C pas à pas et dessine chaque fork.

\`\`\`bash
ps -ef --forest | head -20
\`\`\`
montre l'arbre réel des processus de votre Ubuntu.`,
  },
  {
    id: "agent",
    group: "rAImy",
    title: "Utiliser rAImy Agent",
    keywords: "agent ia claude anthropic cle api modele cout tokens assistant",
    body: `rAImy Agent est propulsé par **Claude** (Anthropic). Il peut lire vos fichiers, écrire du code et lancer des commandes dans Ubuntu.

## Activer l'agent
1. Créez un compte sur **console.anthropic.com** et une clé API (*Settings → API Keys*).
2. Dans rAImy Agent, cliquez sur ⚙ et collez la clé. Elle reste sur votre ordinateur.

## Vous gardez le contrôle
- Lire un fichier ou lister un dossier : automatique.
- **Lancer une commande ou écrire un fichier : l'agent attend votre clic** sur *Exécuter* / *Écrire le fichier*. Vous voyez la commande exacte ou le contenu complet avant.
- Le *Mode autonome* (case en haut de la conversation) supprime ces validations pour la conversation en cours seulement.

## Bien s'en servir
- *« Pourquoi mon programme affiche n'importe quoi ? »* — depuis Code Studio, le bouton **Corriger** envoie le code et la sortie du terminal.
- *« Explique-moi la différence entre un tableau et un pointeur »* — il répond avec un exemple que vous pouvez ouvrir dans Code Studio.
- *« Installe numpy dans un venv pour mon projet ~/tp3 »* — il propose les commandes, vous validez.

## Modèles et coût
L'API est facturée à l'usage (tokens). **Claude Opus 5.5** est le plus capable ; **Sonnet 5.5** est plus rapide ; **Haiku 5.5** est le plus économique. Le bas de la conversation affiche les tokens utilisés. La *profondeur de réflexion* « Rapide » coûte moins cher pour les questions simples.`,
  },
  {
    id: "raccourcis",
    group: "rAImy",
    title: "Raccourcis clavier",
    keywords: "raccourcis clavier shortcuts touches",
    body: `| Raccourci | Action |
|---|---|
| Ctrl + Maj + Espace | Recherche universelle (apps, programmes, fichiers, \`$ commande\`) |
| Ctrl + Maj + A | rAImy Agent |
| Ctrl + Maj + P | Palette de commandes |
| Ctrl + Alt + T | Terminal |
| Ctrl + Alt + E | Nouvelle fenêtre Fichiers |
| Ctrl + Alt + C | Code Studio |
| Ctrl + Alt + D | Afficher le bureau |
| Ctrl + Alt + ← / → / ↑ / ↓ | Ancrer, agrandir, restaurer la fenêtre active |
| Ctrl + Alt + W | Fermer la fenêtre active |
| F11 | Plein écran |
| **Code Studio** : Ctrl + S · Ctrl + Entrée · F5 · Maj + F5 | Enregistrer · exécuter · exécuter · déboguer |
| **Terminal** : Ctrl + Maj + T · Ctrl + Maj + C / V | Nouvel onglet · copier / coller |
| **Fichiers** : Entrée · F2 · Suppr · Alt + ← | Ouvrir · renommer · supprimer · précédent |`,
  },
  {
    id: "depannage",
    group: "rAImy",
    title: "Dépannage",
    keywords: "probleme erreur depannage bug ne marche pas terminal wsl gcc introuvable",
    body: `## Le terminal ne démarre pas
- Ouvrez **Ubuntu & WSL** : la distribution doit être listée. Sinon, suivez *Installer WSL 2 et Ubuntu*.
- Dans PowerShell : \`wsl --shutdown\` puis relancez rAImy OS.

## « gcc : command not found » ou « python3 : introuvable »
Installez les outils (page *Installer les outils de développement*).

## Code Studio n'arrive pas à enregistrer
Choisissez un dossier où vous avez les droits d'écriture, par exemple votre dossier Linux \`/home/votre-nom\`. Les racines comme \`C:\\\` ou \`/\` sont protégées volontairement.

## rAImy Agent répond « clé API refusée »
La clé a été révoquée ou mal copiée : générez-en une nouvelle sur console.anthropic.com et remplacez-la dans les réglages de l'agent.

## Tout est lent
- Projets sur \`/mnt/c\` : déplacez-les dans \`/home\`.
- Limitez la mémoire de WSL avec un fichier \`%UserProfile%\\.wslconfig\` :
\`\`\`ini
[wsl2]
memory=4GB
\`\`\`
puis \`wsl --shutdown\` dans PowerShell.`,
  },
];

export const GUIDE_INDEX = GUIDE.map(({ id, title, keywords, group }) => ({ id, title, keywords, group }));
