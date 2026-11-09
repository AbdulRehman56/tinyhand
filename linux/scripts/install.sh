#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  install.sh              do bin+assets+icon (X11 app)
  install.sh --extension  additionally install GNOME Shell companion
  install.sh --autostart  additionally add X11-only autostart
  install.sh --uninstall  remove installed files (keeps config)
  install.sh --uninstall --purge  also remove config
EOF
}

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
DATA_DIR="$HOME/.local/share/tinyhand"
BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
EXTENSION_ID=tinyhand@abdulrehmankhan56
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_ID"
AUTOSTART_FILE="$HOME/.config/autostart/tinyhand.desktop"
CONFIG_FILE="$HOME/.config/tinyhand/config.json"
want_extension=false
want_autostart=false
uninstall=false
purge=false

for arg in "$@"; do
  case "$arg" in
    --extension) want_extension=true ;;
    --help|-h) usage; exit 0 ;;
    --autostart) want_autostart=true ;;
    --uninstall) uninstall=true ;;
    --purge) purge=true ;;
    *) usage >&2; exit 1 ;;
  esac
done

if $uninstall; then
  rm -f "$BIN_DIR/tinyhand" "$BIN_DIR/tinyhand-settings" "$ICON_DIR/tinyhand.png" "$AUTOSTART_FILE" "$HOME/.local/share/applications/tinyhand-settings.desktop"
  rm -rf "$DATA_DIR" "$EXTENSION_DIR"
  if $purge; then rm -f "$CONFIG_FILE"; fi
  printf 'Removed TinyHand binary, assets, icon, autostart, and extension.\n'
  if ! $purge; then printf 'Kept config: %s\n' "$CONFIG_FILE"; fi
  exit 0
fi

mkdir -p "$BIN_DIR"
if ! command -v cargo >/dev/null 2>&1; then
  printf 'Warning: cargo not found; skipping binary build. Install Rust and rerun.\n' >&2
else
  (cd "$REPO_ROOT/linux" && cargo build --release)
  cp "$REPO_ROOT/linux/target/release/tinyhand" "$BIN_DIR/tinyhand"
  printf 'Installed binary: %s\n' "$BIN_DIR/tinyhand"
fi

mkdir -p "$DATA_DIR/assets/sounds"
cp "$REPO_ROOT"/assets/hand_*.png "$DATA_DIR/assets/"
cp "$REPO_ROOT"/assets/sounds/tap_*.wav "$DATA_DIR/assets/sounds/"
printf 'Installed hand and sound assets: %s\n' "$DATA_DIR/assets"

# Native GTK4/libadwaita settings are usable independently of the Shell overlay.
SETTINGS_SRC="$REPO_ROOT/linux/companion/$EXTENSION_ID"
mkdir -p "$DATA_DIR/settings" "$HOME/.local/share/applications"
cp "$SETTINGS_SRC/preferences.js" "$SETTINGS_SRC/settings.js" "$SETTINGS_SRC/experimental.js" "$DATA_DIR/settings/"
cat > "$BIN_DIR/tinyhand-settings" <<'EOF'
#!/usr/bin/env sh
exec gjs -m "$HOME/.local/share/tinyhand/settings/settings.js" "$@"
EOF
chmod +x "$BIN_DIR/tinyhand-settings"
cat > "$HOME/.local/share/applications/tinyhand-settings.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TinyHand Settings
Comment=Choose your hand, ink, size, and tap sounds
Exec="$BIN_DIR/tinyhand-settings"
Icon=tinyhand
Categories=Settings;Utility;
StartupNotify=true
EOF
printf 'Installed customization UI: %s/tinyhand-settings\n' "$BIN_DIR"

mkdir -p "$ICON_DIR"
icon=$(find "$REPO_ROOT/assets" -maxdepth 1 -type f -name 'icon*.png' -print -quit)
if [[ -n "$icon" ]]; then
  cp "$icon" "$ICON_DIR/tinyhand.png"
else
  cp "$REPO_ROOT/assets/hand_lavender.png" "$ICON_DIR/tinyhand.png"
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi
printf 'Installed tray icon: %s/tinyhand.png\n' "$ICON_DIR"

if $want_extension; then
  EXTENSION_SRC="$REPO_ROOT/linux/companion/$EXTENSION_ID"
  if [[ ! -d "$EXTENSION_SRC" ]]; then
    printf 'GNOME companion source not found: %s\n' "$EXTENSION_SRC" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$EXTENSION_DIR")"
  mkdir -p "$EXTENSION_DIR"
  cp -R "$EXTENSION_SRC/." "$EXTENSION_DIR/"
  glib-compile-schemas --strict "$EXTENSION_DIR/schemas/"
  printf 'Installed GNOME extension: %s\n' "$EXTENSION_DIR"
  printf 'Enable via Extensions app or: gnome-extensions enable %s\n' "$EXTENSION_ID"
fi

if $want_autostart; then
  mkdir -p "$(dirname "$AUTOSTART_FILE")"
  cat > "$DATA_DIR/start-x11.sh" <<'EOF'
#!/usr/bin/env sh
[ "${XDG_SESSION_TYPE:-}" = x11 ] || exit 0
exec "$HOME/.local/bin/tinyhand" run
EOF
  chmod +x "$DATA_DIR/start-x11.sh"
  cat > "$AUTOSTART_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=TinyHand
Comment=Start TinyHand in X11 sessions
Exec="$DATA_DIR/start-x11.sh"
X-GNOME-Autostart-enabled=true
EOF
  printf 'Installed X11-only autostart: %s\n' "$AUTOSTART_FILE"
  printf 'Under Wayland, use the GNOME Shell extension instead.\n'
fi

printf 'TinyHand install complete. Binary: %s/tinyhand; data: %s\n' "$BIN_DIR" "$DATA_DIR"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH, or run %s/tinyhand directly.\n' "$BIN_DIR" "$BIN_DIR" ;;
esac
