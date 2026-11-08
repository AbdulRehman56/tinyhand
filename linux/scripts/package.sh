#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: package.sh [--extension-only]

Build release artifacts in linux/dist without modifying source assets.
  --extension-only  Build only the self-contained GNOME/EGO ZIP (no Cargo).
  --help, -h        Show this help.

Build dependencies: Python 3 + Pillow (python3 -m pip install Pillow),
glib-compile-schemas (Ubuntu: libglib2.0-bin), and, for the default portable
Linux bundle, Rust/Cargo. Run on the target Linux architecture.
All 36 hands are resized to 384x576 RGBA PNG using LANCZOS (no palette
quantization); all six tap sounds are included. Source assets are unchanged.
SOURCE_DATE_EPOCH optionally controls archive timestamps (default 2024-01-01).
The installed app needs X11; settings need GJS, GTK 4.8+ and libadwaita 1.4+, and sounds
use paplay. Neither installing a bundle nor using the extension needs Cargo.
EOF
}

extension_only=false
for arg in "$@"; do
  case "$arg" in
    --extension-only) extension_only=true ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage >&2; exit 1 ;;
  esac
done
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LINUX_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(cd -- "$LINUX_DIR/.." && pwd)
DIST="$LINUX_DIR/dist"
EXTENSION_ID=tinyhand@abdulrehmankhan56
EXTENSION_SRC="$LINUX_DIR/companion/$EXTENSION_ID"
for dep in python3 glib-compile-schemas; do
  command -v "$dep" >/dev/null || { printf 'Missing build dependency: %s\n' "$dep" >&2; exit 1; }
done
python3 -c 'from PIL import Image' || { printf 'Install Pillow: python3 -m pip install Pillow\n' >&2; exit 1; }
python3 - "$EXTENSION_SRC/metadata.json" <<'PY'
import json, re, sys
metadata = json.load(open(sys.argv[1]))
if not re.fullmatch(r'[A-Za-z0-9. ]+', metadata.get('version-name', '')):
    raise SystemExit('GNOME version-name must contain only ASCII letters, digits, spaces and dots')
PY
if ! $extension_only; then
  [[ $(uname -s) == Linux ]] || { printf 'Build portable bundles on Linux.\n' >&2; exit 1; }
  command -v cargo >/dev/null || { printf 'Missing build dependency: cargo\n' >&2; exit 1; }
  cargo build --manifest-path "$LINUX_DIR/Cargo.toml" --locked --release
fi
mkdir -p "$DIST"
STAGE=$(mktemp -d "$DIST/.package.XXXXXX")
trap 'rm -rf -- "$STAGE"' EXIT
mkdir -p "$STAGE/extension/schemas"
for file in metadata.json extension.js prefs.js preferences.js; do
  cp "$EXTENSION_SRC/$file" "$STAGE/extension/$file"
done
cp "$EXTENSION_SRC"/schemas/*.gschema.xml "$STAGE/extension/schemas/"
glib-compile-schemas --strict "$STAGE/extension/schemas"
# GNOME 45+ compiles schemas during installation; validate them here but ship XML only.
rm -f "$STAGE/extension/schemas/gschemas.compiled"
cp "$REPO_ROOT/LICENSE" "$STAGE/extension/LICENSE"
cat > "$STAGE/extension/CREDITS" <<'EOF'
TinyHand original app and hand/sound assets: Kamran Ahmed (@nilbuild).
Upstream: https://github.com/nilbuild/tinyhand
Website: https://tinyhand.app
Linux port: AbdulRehman56, https://github.com/AbdulRehman56/tinyhand
Distributed under the included MIT LICENSE.
Release PNGs are resized copies of the original artwork, preserving alpha.
EOF
python3 - "$REPO_ROOT" "$STAGE/extension" "$DIST/$EXTENSION_ID.shell-extension.zip" <<'PY'
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path
from PIL import Image

root, stage, output = map(Path, sys.argv[1:])
hands = sorted((root / 'assets').glob('hand_*.png'))
sounds = sorted((root / 'assets/sounds').glob('tap_*.wav'))
if len(hands) != 36 or len(sounds) != 6:
    raise SystemExit(f'Expected 36 hands and 6 sounds; found {len(hands)} and {len(sounds)}')
(stage / 'assets/sounds').mkdir(parents=True)
for source in hands:
    with Image.open(source) as original:
        if original.width * 3 != original.height * 2:
            raise SystemExit(f'Unexpected hand aspect ratio: {source}')
        image = original.convert('RGBA').resize((384, 576), Image.Resampling.LANCZOS)
        image.save(stage / 'assets' / source.name, optimize=True, compress_level=9)
for source in sounds:
    shutil.copyfile(source, stage / 'assets/sounds' / source.name)
epoch = int(os.environ.get('SOURCE_DATE_EPOCH', '1704067200'))
timestamp = time.gmtime(max(315532800, min(epoch, 4354819198)))[:6]
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(stage.rglob('*')):
        if path.is_file():
            info = zipfile.ZipInfo(path.relative_to(stage).as_posix(), timestamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compresslevel=9)
print(f'{output}: {output.stat().st_size:,} bytes ({output.stat().st_size / 1048576:.2f} MiB)')
if output.stat().st_size >= 10 * 1024 * 1024:
    raise SystemExit('Extension exceeds the 10 MiB packaging budget')
PY

if ! $extension_only; then
  ARCH=$(uname -m)
  BUNDLE_NAME="tinyhand-linux-$ARCH"
  BUNDLE="$STAGE/$BUNDLE_NAME"
  mkdir -p "$BUNDLE/bin" "$BUNDLE/share/tinyhand/settings"
  TARGET_DIR=$(cargo metadata --manifest-path "$LINUX_DIR/Cargo.toml" --locked --no-deps --format-version 1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')
  cp "$TARGET_DIR/release/tinyhand" "$BUNDLE/bin/tinyhand"
  cp -R "$STAGE/extension/assets" "$BUNDLE/share/tinyhand/assets"
  cp "$EXTENSION_SRC/preferences.js" "$EXTENSION_SRC/settings.js" "$BUNDLE/share/tinyhand/settings/"
  cp "$STAGE/extension/LICENSE" "$STAGE/extension/CREDITS" "$BUNDLE/"
  cp "$SCRIPT_DIR/install-release.sh" "$BUNDLE/install.sh"
  cat > "$BUNDLE/bin/tinyhand-settings" <<'EOF'
#!/usr/bin/env sh
PREFIX=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec gjs -m "$PREFIX/share/tinyhand/settings/settings.js" "$@"
EOF
  chmod 755 "$BUNDLE/bin/tinyhand" "$BUNDLE/bin/tinyhand-settings" "$BUNDLE/install.sh"
  cat > "$BUNDLE/README.txt" <<'EOF'
TinyHand for Linux — portable X11 app

Run ./install.sh to install under ~/.local (no sudo, Rust or Cargo required).
Start ~/.local/bin/tinyhand in an X11 session; open TinyHand Settings from
your app launcher or run ~/.local/bin/tinyhand-settings.
Settings require GJS, GTK 4.8+ and libadwaita 1.4+. Tap sounds use paplay.
To remove installed release files: ./install.sh --uninstall (keeps config).
For GNOME Wayland, install the separate .shell-extension.zip with
gnome-extensions install --force PATH and enable tinyhand@abdulrehmankhan56.
The portable bundle does not install or enable a GNOME extension.
This binary is not compatible with every Linux distribution. Check the
architecture and build-host glibc version in BUILD-INFO.txt; older glibc
systems should build the app from source instead.
See LICENSE and CREDITS for original artwork and Linux port attribution.
EOF
  {
    printf 'TinyHand Linux binary build information\nArchitecture: %s\n' "$ARCH"
    printf 'Build-host libc: '
    getconf GNU_LIBC_VERSION
    printf 'Rust compiler: '
    rustc --version
    printf '\nBuilt on this libc version; compatibility with older libc versions is not guaranteed.\n'
  } > "$BUNDLE/BUILD-INFO.txt"
  python3 - "$STAGE" "$BUNDLE_NAME" "$DIST/$BUNDLE_NAME.tar.gz" <<'PY'
import gzip
import os
import sys
import tarfile
from pathlib import Path

stage, name, output = sys.argv[1:]
epoch = int(os.environ.get('SOURCE_DATE_EPOCH', '1704067200'))
def normalize(info):
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    info.mtime = epoch
    return info
with open(output, 'wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=epoch) as compressed:
    with tarfile.open(fileobj=compressed, mode='w') as archive:
        archive.add(Path(stage) / name, arcname=name, filter=normalize)
size = Path(output).stat().st_size
print(f'{output}: {size:,} bytes ({size / 1048576:.2f} MiB)')
PY
fi
