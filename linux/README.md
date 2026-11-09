# TinyHand for Linux

TinyHand is a tiny hand on a stick that points at things on your screen: click to play a tap sound, or hold and drag to draw ink that fades after 3 seconds. This Linux port (branch `linux-port`) is based on [nilbuild/tinyhand](https://github.com/nilbuild/tinyhand) and is MIT-licensed.

## Which mode do I need?

| Session | Mode |
| --- | --- |
| Xorg/X11 | The Rust app, `tinyhand`, hides the real cursor, swallows clicks for tapping/drawing, lets panels/dock areas pass through, and provides a StatusNotifier tray menu (toggle / next hand / clear / quit). Hold Alt to interact normally. |
| GNOME Wayland (45–50; 45–49 experimental) | The companion Shell extension draws the hand as a shell overlay. **Point** mode allows normal clicks without ink. **Draw** mode captures pointer drags, avoiding text selection underneath; hold **Alt** to interact normally. The system cursor can be hidden. The bottom toolbar offers hand previews, Point/Draw, ink colors, sound, clear, settings, and hide. |

Both modes share `~/.config/tinyhand/config.json`. Run only one mode at a time. This is an experimental prerelease; GNOME 50.1 is the only desktop-tested version. The toolkit additionally passed an isolated real GNOME 50.1 load/config-reload/disable/re-enable test; hands-on input and mixed-DPI testing remain limited. See [COMPATIBILITY.md](./COMPATIBILITY.md) for the version matrix, library minimums and testing limits.

## Install

```sh
./linux/scripts/install.sh              # X11 app + assets + icon, from repo root
./linux/scripts/install.sh --extension  # + GNOME Wayland companion
```

Enable the extension with `gnome-extensions enable tinyhand@abdulrehmankhan56` or use the Extensions app. If it does not show up, log out and back in once.

Rust/Cargo is needed to build the X11 app; no system development headers are required. The companion uses GJS, Cairo and GdkPixbuf shipped with GNOME; Shell code does not import Gdk, Gtk or Adw. Preferences run separately with GTK4/libadwaita. Installation stays under your home directory and does not enable the extension automatically.

For packages that need no Cargo, see the fork's [releases](https://github.com/AbdulRehman56/tinyhand/releases). Build the self-contained extension ZIP and portable X11 tarball with `./linux/scripts/package.sh`, or use `--extension-only` to skip Rust. Packaging needs Python 3 with Pillow and `glib-compile-schemas`. Source artwork remains unchanged; packages contain resized RGBA copies. Check the tarball's `BUILD-INFO.txt` for architecture and glibc requirements.

## Usage

- Open **TinyHand Settings** from your app launcher, run `tinyhand-settings`, or use the toolbar gear. The macOS-inspired sidebar has a searchable visual picker for all 37 pointers plus appearance, drawing, and sound controls. Pin up to six hands to the toolbar; selecting an unpinned hand keeps it accessible as an extra toolbar item. Changes apply immediately; no JSON editing needed. Settings requires GJS, GTK 4.8+, and libadwaita 1.4+.
- `tinyhand` — run the app (needs X11; with `WAYLAND_DISPLAY` set it warns and explains).
- Hotkeys in both modes: Ctrl+Alt+H toggle · Ctrl+Alt+X clear ink · Ctrl+Alt+P next hand.
- GNOME Toolkit settings add spotlight/click ripples, privacy-restricted shortcut display,
  line/arrow drawing, undo, permanent ink, a movable/collapsible toolbar, profiles,
  exact per-app rules, custom PNG sprites, volume and accessibility controls.
- Extra GNOME shortcuts: Ctrl+Alt+D Point/Draw, Ctrl+Alt+Z undo, Ctrl+Alt+S presentation.
  Edit or disable any of the six shortcuts in Settings → Toolkit.
- To try the actual hand inside an isolated GNOME window: `./linux/scripts/preview-shell.sh`.
  `preview-experiment.sh` opens settings only, not an overlay. See [EXPERIMENT.md](./EXPERIMENT.md).
- `tinyhand --selftest` renders sample poses to `/tmp/tinyhand-selftest/*.png` (checks assets and fingertip accuracy); `tinyhand --config` prints the config path; `tinyhand --help` shows help.

## Development checks

```sh
cargo test --manifest-path linux/Cargo.toml
cargo run --manifest-path linux/Cargo.toml -- --selftest
node --test linux/tests/*.test.cjs
gjs -m linux/tests/companion-render.mjs
# On a graphical desktop, validates actual allocations and isolated setting writes:
test_config=$(mktemp -d -t tinyhand-layout.XXXXXX)
XDG_CONFIG_HOME="$test_config" gjs -m linux/tests/preferences-layout.mjs
gjs -m linux/tests/preferences-experiment.mjs
glib-compile-schemas --strict --dry-run linux/companion/tinyhand@abdulrehmankhan56/schemas
```

Offline rendering and logic checks cannot verify shortcut conflicts, click-through behavior, or compatibility with other GNOME extensions. Test those on your desktop after enabling the companion.

## Config (`~/.config/tinyhand/config.json`)

Config is shared by both apps and hot-reloads on save.

| Key | Values / meaning |
| --- | --- |
| `pointer.style` | `lavender`, `glove`, `coral`, `plush`, `robot`, `pink`, `blue`, `mint`, `lemon`, `black`, `chrome`, `holo`, `fuzzy`, `wood`, `marble`, `terrazzo`, `glass`, `jelly`, `pastel`, `pixel`, `lowpoly`, `knit`, `skeleton`, `astro`, `space`, `monster`, `water`, `lava`, `grass`, `cactus`, `choco`, `cloud`, `mech`, `neon`, `leaf`, `cookie`, or `laser` |
| `pointer.size` | Hand size as a fraction of screen height, `0.08`–`0.20` (default `0.13`). |
| `pointer.shadow` | Boolean. |
| `toolbar.pinnedStyles` | GNOME only: an ordered array of up to six style IDs; duplicates and unknown IDs are ignored. An empty array hides favorites; the selected pointer stays visible. |
| `interaction.mode`, `interaction.hideCursor` | GNOME only: `point` (default, normal clicks/no ink) or `draw` (captures drags); hide the system cursor by default. Cursor visibility is restored when TinyHand is disabled. |
| `ink.choice` | `match` (each hand's matching color), or `red` / `orange` / `yellow` / `green` / `blue` / `purple` / `white` / `black`. |
| `ink.fade` | Seconds; `0` keeps strokes until cleared. |
| `sound.hand`, `sound.laser` | Booleans for tap sounds on hand and laser clicks. |
| `sound.tap` | `thock`, `click`, `pop`, `wood`, `boop`, or `squeak`. |
| `interact.key` | X11 only: `alt`, `ctrl`, `super`, or `off`; hold this key so clicks pass through to apps under the hand. |
| `hotkeys.toggle`, `hotkeys.clear`, `hotkeys.cycle` | X11 shortcuts; defaults are `ctrl+alt+h`, `ctrl+alt+x`, `ctrl+alt+p`. GNOME uses the extension's GSettings `toggle`, `clear`, and `cycle` keys instead. |

## Troubleshooting

- “no 32-bit RGBA visual…”: the X11 session has no compositor.
- Running the X11 app inside Wayland only affects XWayland windows; prefer the extension there.
- The tray icon needs an AppIndicator extension (for example, dash-to-panel with appindicator).
- X11 taps, preferences previews and reduced-volume Shell taps use `paplay` (PulseAudio/PipeWire); full-volume Shell taps use GNOME's sound player.
- If assets are missing, run `linux/scripts/install.sh`, or run from the repo root (the app also looks in ancestor `assets/` directories).
- Config saves hot-reload. GNOME cycling follows your pinned favorites (or the default six if none are pinned); the X11 app still uses its default favorites.
- GNOME currently uses the whole stage for sizing/anchoring; mixed-scale and multi-monitor layouts need testing. The minimum rod length can offset the fingertip near the bottom-right corner. Very quick clicks can be missed by pointer polling.
- To disable on GNOME: `gnome-extensions disable tinyhand@abdulrehmankhan56`. To remove installed files: `./linux/scripts/install.sh --uninstall` (keeps config; add `--purge` to remove it).

Upstream: https://github.com/nilbuild/tinyhand · Fork: https://github.com/AbdulRehman56/tinyhand (branch `linux-port`) · MIT.
