#!/usr/bin/env bash
set -e

REPO="https://github.com/senshiKimura/TheDash.git"
INSTALL_DIR="$HOME/.local/share/thedash"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"

echo ""
echo "╔══════════════════════════════╗"
echo "║       TheDash Installer      ║"
echo "╚══════════════════════════════╝"
echo ""

# ── Check git ────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo "❌  git est requis. Installez-le :"
  echo "    Ubuntu/Debian : sudo apt install git"
  echo "    Arch          : sudo pacman -S git"
  exit 1
fi

# ── Check Node.js 18+ ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "→ Node.js non trouvé. Installation via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌  Node.js 18+ requis (trouvé $(node -v)). Veuillez mettre à jour."
  exit 1
fi

# ── Clone ou mise à jour ─────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Mise à jour de TheDash..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "→ Clonage de TheDash..."
  git clone "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Dépendances ──────────────────────────────────────────────────────
echo "→ Installation des dépendances..."
npm install --silent

# ── Build AppImage ───────────────────────────────────────────────────
echo "→ Build AppImage (peut prendre une minute)..."
npm run build:linux 2>&1 | grep -E "^\s*(•|✔|✖|Error|error)" || true

APPIMAGE=$(find dist -maxdepth 1 -name "*.AppImage" 2>/dev/null | head -1)
if [ -z "$APPIMAGE" ]; then
  echo "❌  Build échoué : aucun AppImage trouvé dans dist/"
  echo "    Essayez manuellement : cd $INSTALL_DIR && npm run build:linux"
  exit 1
fi

# ── Installation ─────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
cp "$APPIMAGE" "$BIN_DIR/thedash.AppImage"
chmod +x "$BIN_DIR/thedash.AppImage"

# ── Entrée .desktop ──────────────────────────────────────────────────
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/thedash.desktop" <<EOF
[Desktop Entry]
Name=TheDash
Comment=Dashboard personnel et gestion de projets
Exec=$BIN_DIR/thedash.AppImage --no-sandbox
Icon=$INSTALL_DIR/assets/logo.png
Type=Application
Categories=Utility;
StartupNotify=true
EOF

# ── PATH ─────────────────────────────────────────────────────────────
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo ""
  echo "⚠  Ajoutez ~/.local/bin à votre PATH :"
  echo '   echo '"'"'export PATH="$HOME/.local/bin:$PATH"'"'"' >> ~/.bashrc && source ~/.bashrc'
fi

echo ""
echo "✅  TheDash installé !"
echo "   Lancer :    $BIN_DIR/thedash.AppImage"
echo "   Ou depuis le menu applications (après reconnexion)"
echo ""
