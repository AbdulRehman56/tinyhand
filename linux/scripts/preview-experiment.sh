#!/usr/bin/env bash
set -euo pipefail
# Settings-only sandbox: never installs or reloads the GNOME extension.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_dir="$script_dir/../companion/tinyhand@abdulrehmankhan56"
state="${TINYHAND_EXPERIMENT_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/tinyhand-experiment}"
mkdir -p "$state/config" "$state/data" "$state/cache" "$state/schemas"
cp "$source_dir"/schemas/*.gschema.xml "$state/schemas/"
glib-compile-schemas --strict "$state/schemas"
printf 'Isolated TinyHand experiment: %s\nNo live extension/configuration is changed.\n' "$state"
export XDG_CONFIG_HOME="$state/config" XDG_DATA_HOME="$state/data" XDG_CACHE_HOME="$state/cache"
export GSETTINGS_SCHEMA_DIR="$state/schemas" GSETTINGS_BACKEND=memory
exec gjs -m "$source_dir/settings.js" --experiment "$@"
