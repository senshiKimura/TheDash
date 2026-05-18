# TheDash

**TheDash** est un dashboard personnel et outil de gestion de projets construit avec Electron. Fonctionne entièrement hors-ligne par défaut, avec une synchronisation optionnelle via [TheDashServer](./TheDashServer/README.md).

---

## Fonctionnalités

- **Dashboard** — Vue d'ensemble des projets actifs, échéances proches, tâches récentes
- **Gestion de projets** — Tâches Kanban, journal, documents, relances, tableau blanc, post-its
- **Journal** — Entrées taguées (Note / Info / Action / Avancement / Décision / CR / Idée), vue liste ou timeline schéma
- **Éditeur riche** — Gras, italique, titres, listes dans les descriptions et journaux
- **Notes rapides** — Prises de notes avec éditeur riche et catégories
- **Ressources** — Gestionnaire de fichiers et liens avec catégories colorées
- **Pomodoro** — Widget flottant 25/5/15 min avec anneau SVG animé
- **Mode sombre**
- **System tray** — Reste dans la barre de tâches quand on ferme la fenêtre
- **Sync** *(optionnel)* — Synchronisation multi-machines via TheDashServer auto-hébergé

---

## Installation

### Windows

```bash
git clone https://github.com/senshiKimura/TheDash.git
cd TheDash
npm install
npm start
```

Pour builder un `.exe` portable :

```bash
npm run build       # → dist/TheDash.exe
```

### Linux

**Installation rapide** (build depuis les sources) :

```bash
curl -fsSL https://raw.githubusercontent.com/senshiKimura/TheDash/main/install.sh | bash
```

Ou manuellement :

```bash
git clone https://github.com/senshiKimura/TheDash.git
cd TheDash
npm install
npm run build:linux   # → dist/TheDash-*.AppImage + .deb
chmod +x dist/*.AppImage
./dist/*.AppImage
```

> Requires: Node.js 18+, git

---

## Dev

```bash
git clone https://github.com/senshiKimura/TheDash.git
cd TheDash
npm install
npm start
```

Les données sont stockées dans :
- Windows : `%APPDATA%\TheDash\`
- Linux : `~/.config/TheDash/`

---

## Sync avec TheDashServer *(optionnel)*

TheDash fonctionne entièrement hors-ligne. Pour synchroniser entre plusieurs machines, déployez [TheDashServer](./TheDashServer/README.md) sur un serveur Linux ou une machine locale.

Dans l'app : **Paramètres → Serveur → Mode sync → Sync activée**, puis renseignez l'URL du serveur et la clé API.

---

## Stack

- [Electron](https://electronjs.org/) 41 — framework desktop
- Vanilla JS / HTML / CSS — aucun bundler, aucun framework UI
- Données : fichiers JSON via `app.getPath('userData')`
