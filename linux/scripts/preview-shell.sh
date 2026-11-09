#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
"$script_dir/package.sh" --extension-only
cp "$script_dir/../dist/tinyhand@abdulrehmankhan56.shell-extension.zip" \
   "$script_dir/../dist/tinyhand-local-experiment.shell-extension.zip"
printf 'Starting TinyHand inside a separate GNOME test window, not over your main desktop.\n'
exec python3 "$script_dir/../tests/shell-smoke.py" --windowed
