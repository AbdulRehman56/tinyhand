#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install.sh [--uninstall]
Install this extracted TinyHand Linux bundle under ~/.local, without sudo
or Cargo. Requires an X11 desktop; settings need GJS, GTK 4.8+ and libadwaita 1.4+.
Tap sounds use paplay. --uninstall removes only release-installed paths,
leaving your configuration and GNOME Shell extension untouched.
EOF
}
uninstall=false
for arg in "$@"; do
  case "$arg" in
    --uninstall) uninstall=true ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
BIN="$HOME/.local/bin"
DATA="$HOME/.local/share/tinyhand"
DESKTOP="$HOME/.local/share/applications/tinyhand-settings.desktop"
ICON="$HOME/.local/share/icons/hicolor/256x256/apps/tinyhand.png"
if $uninstall; then
  rm -f -- "$BIN/tinyhand" "$BIN/tinyhand-settings" "$DESKTOP" "$ICON"
  # These subdirectories contain release-owned assets only, not user config.
  rm -rf -- "$DATA/assets" "$DATA/settings"
  rmdir -- "$DATA" 2>/dev/null || true
  printf 'Removed TinyHand release files. Configuration and GNOME extension were kept.\n'
  exit 0
fi
BUNDLE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for file in bin/tinyhand bin/tinyhand-settings share/tinyhand/settings/settings.js share/tinyhand/settings/preferences.js share/tinyhand/settings/experimental.js share/tinyhand/assets/hand_lavender.png; do
  [[ -f "$BUNDLE/$file" ]] || { printf 'Incomplete bundle: missing %s\n' "$file" >&2; exit 1; }
done
mkdir -p "$BIN" "$DATA/assets" "$DATA/settings" "$(dirname -- "$DESKTOP")" "$(dirname -- "$ICON")"
install -m 755 "$BUNDLE/bin/tinyhand" "$BIN/tinyhand"
# Installed settings always use the installed data location, not the extraction.
cat > "$BIN/tinyhand-settings" <<'EOF'
#!/usr/bin/env sh
exec gjs -m "$HOME/.local/share/tinyhand/settings/settings.js" "$@"
EOF
chmod 755 "$BIN/tinyhand-settings"
cp -R "$BUNDLE/share/tinyhand/assets/." "$DATA/assets/"
install -m 644 "$BUNDLE/share/tinyhand/settings/"{preferences,settings,experimental}.js "$DATA/settings/"
install -m 644 "$BUNDLE/share/tinyhand/assets/hand_lavender.png" "$ICON"
# Desktop Exec quoting also escapes characters special inside double quotes.
DESKTOP_EXEC=${BIN//\\/\\\\}
DESKTOP_EXEC=${DESKTOP_EXEC//\"/\\\"}
DESKTOP_EXEC=${DESKTOP_EXEC//\$/\\\$}
DESKTOP_EXEC=${DESKTOP_EXEC//\`/\\\`}
DESKTOP_EXEC=${DESKTOP_EXEC//%/%%}
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=TinyHand Settings
Comment=Choose your hand, ink, size, and tap sounds
Exec="$DESKTOP_EXEC/tinyhand-settings"
Icon=tinyhand
Categories=Settings;Utility;
StartupNotify=true
EOF
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi
printf 'Installed TinyHand: %s/tinyhand\nSettings: %s/tinyhand-settings\n' "$BIN" "$BIN"
printf 'Use X11 for the app; install the separate GNOME extension for Wayland.\n'
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) printf 'Add %s to PATH, or run the full paths above.\n' "$BIN" ;;
esac
