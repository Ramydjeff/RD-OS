# rAImy OS — rAImy Solutions

**rAImy OS** est un environnement de bureau pour étudiants en informatique : un bureau complet (fenêtres, barre des tâches, menu Démarrer, recherche universelle) qui réunit vos programmes **Windows** et un vrai **Ubuntu** (WSL 2) pour programmer en **Python, C et C++**, avec **rAImy Agent**, un assistant IA qui comprend votre environnement.

## Ce qu'il y a dedans

| Application | Rôle |
|---|---|
| **Fichiers** | Explorateur Windows (C:\\, Bureau, Documents…) **et** Linux (/home), ouvrir, renommer, supprimer, exécuter, épingler au bureau |
| **Code Studio** | Éditeur Python / C / C++ / Bash : un clic sur *Exécuter* compile (`gcc -Wall -Wextra -g`) et lance le programme dans un terminal intégré ; erreurs du compilateur surlignées ; gdb, pdb et Valgrind |
| **Terminal** | bash dans Ubuntu (onglets, écrans partagés, recherche) |
| **rAImy Agent** | Assistant IA (Claude d'Anthropic) : explique, corrige, écrit des fichiers et lance des commandes dans Ubuntu **après votre validation** |
| **Applications** | Tous vos programmes Windows (.exe, raccourcis du menu Démarrer), à lancer ou épingler |
| **rAImy Academy** | Guides : installation, WSL, commandes Ubuntu, Python, C, C++, processus, dépannage — avec vérification en direct des outils installés |
| **Simulateur UNIX** | fork / exec / wait pas à pas |
| **Ubuntu & WSL**, **Moniteur**, **Paramètres** | Distributions, ressources, fond d'écran, clé API, raccourcis |

Le **mode Workspace** (IDE classique : explorateur de projet + terminal) reste disponible depuis le menu Démarrer.

## Installer

### Prérequis
- Windows 10 (2004+) ou Windows 11, 64 bits, virtualisation activée dans le BIOS
- WSL 2 et Ubuntu :
  ```powershell
  wsl --install -d Ubuntu-24.04
  ```
- Dans Ubuntu, les outils de développement :
  ```bash
  sudo apt update && sudo apt install -y build-essential gdb valgrind python3 python3-pip python3-venv git make cmake
  ```

### Avec l'installateur
Lancez `rAImy Solutions_0.1.0_x64-setup.exe` (installation pour l'utilisateur courant, sans droits administrateur).

### Depuis les sources
Il faut **Node.js 22**, **Rust** (rustup) et les **Build Tools Visual Studio** (C++).

```powershell
npm install
npm run tauri dev      # développement, rechargement à chaud
npm run tauri build    # installateur dans src-tauri\target\release\bundle\nsis\
```

## Activer rAImy Agent
1. Créez une clé API sur [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Ouvrez **rAImy Agent → ⚙** et collez-la (ou définissez la variable `ANTHROPIC_API_KEY`).

La clé est stockée par le backend Rust dans `%APPDATA%\solutions.raimy.workspace\agent.json` et n'est jamais renvoyée à l'interface. Les commandes et écritures de fichiers proposées par l'agent attendent votre clic (sauf si vous activez le *Mode autonome* pour une conversation).

## Raccourcis

| Raccourci | Action |
|---|---|
| Ctrl + Maj + Espace | Recherche universelle (apps, programmes, fichiers, guides, `$ commande`, question à rAImy) |
| Ctrl + Maj + A | rAImy Agent |
| Ctrl + Alt + T / E / C / G | Terminal / Fichiers / Code Studio / Guides |
| Ctrl + Alt + ← → ↑ ↓ | Ancrer à gauche / à droite, agrandir, restaurer |
| Ctrl + Alt + D | Afficher le bureau |
| F11 | Plein écran |

Glisser une fenêtre contre un bord de l'écran l'ancre (gauche/droite) ou l'agrandit (haut).

## Architecture
- **Frontend** : React 19 + TypeScript + Tailwind 4 (`src/`). Le bureau est dans `src/components/desktop`, les applications dans `src/components/apps`, les états dans `src/store` (zustand).
- **Backend** : Tauri 2 + Rust (`src-tauri/`). Terminaux via ConPTY + `wsl.exe`, opérations fichiers sécurisées, `agent.rs` (API Claude en streaming, clé côté backend), `desktop.rs` (programmes Windows, ouverture de fichiers, disposition du bureau).
- Chaque commande backend est autorisée explicitement dans `src-tauri/capabilities/default.json`.

## Tests
```powershell
npx vitest run --pool=threads
cargo test --manifest-path src-tauri/Cargo.toml
```
