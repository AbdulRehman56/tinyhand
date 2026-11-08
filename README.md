<img src="./.github/logo.png" width="80" alt="TinyHand logo" />

# TinyHand — Linux port

A tiny hand on a stick that points at things on your screen, with tap sounds and screen drawing.

**TinyHand was created by [Kamran Ahmed (@nilbuild)](https://github.com/nilbuild).**
The original app, artwork, and macOS experience come from
[nilbuild/tinyhand](https://github.com/nilbuild/tinyhand) and [tinyhand.app](https://tinyhand.app).
This independent, open-source Linux fork is maintained by
[AbdulRehman56](https://github.com/AbdulRehman56), not the original creator.

[MIT license](./LICENSE) · [Linux releases](https://github.com/AbdulRehman56/tinyhand/releases) ·
[Linux technical guide](./linux/README.md) · [Contributing](./linux/CONTRIBUTING.md)

## Linux status

**Experimental preview, not full macOS parity.** The GNOME companion targets Shell
**45–50**. GNOME **45–49 are experimental**, based on versioned API checks and mocks;
they have not been desktop-tested. **50.1 is the only desktop-tested version**; the
latest compatibility changes have not been hot-loaded into that session.
See the [compatibility assessment](./linux/COMPATIBILITY.md) for evidence and limits.
The Rust X11 app is also experimental.

| Desktop session | Use |
| --- | --- |
| GNOME Wayland | GNOME Shell companion extension; recommended Linux path. |
| Xorg/X11 | Rust `tinyhand` app; do not run it alongside the companion. |
| Other Wayland desktops | No native compositor integration currently provided. |

The GNOME Extensions (EGO) listing is **not submitted or approved**. The extension ZIP
is ready for maintainer upload.
Check [releases](https://github.com/AbdulRehman56/tinyhand/releases) for published
packages. The prerelease pipeline builds a self-contained extension ZIP
and an x86_64 X11 tarball with an installer that needs no Cargo, plus SHA-256 checksums.

For the extension ZIP, run `gnome-extensions install --force PATH_TO_ZIP`, then enable
`tinyhand@abdulrehmankhan56` after your next login if needed. Open its settings through
the Extensions app or toolbar gear. For the X11 tarball, extract it and run `./install.sh`;
remove it with `./install.sh --uninstall` (keeps config). Check `BUILD-INFO.txt` before
running the binary: builds require at least the build host's glibc version and matching
architecture. GitHub Actions builds on Ubuntu 24.04; local builds may require newer glibc.

## Install Linux from source

Requirements: Git; Rust/Cargo to build the X11 app; a GNOME session for the companion.
Settings needs GJS, GTK **4.8+**, and libadwaita **1.4+**; extension installation also needs
`glib-compile-schemas`. X11 audio and settings sound previews use `paplay`
(PulseAudio/PipeWire); Shell tap sounds use GNOME's sound player, not `paplay`.
The Rust build does not require system development headers.

Review the installer before running it. Installation is per-user under `~/.local/`;
**do not use sudo**. No remote script piping is needed.

```sh
git clone --branch linux-port https://github.com/AbdulRehman56/tinyhand.git
cd tinyhand
./linux/scripts/install.sh --extension
gnome-extensions enable tinyhand@abdulrehmankhan56
```

The installer copies the extension but does not enable it automatically. A newly installed
extension directory may not be discovered until your **next login**: log out and back in,
then enable it with the command above or the Extensions app. Reinstalling files does not
guarantee that an already running Shell loads the new code immediately.

For X11 only, omit `--extension`, then run `~/.local/bin/tinyhand`.
Add `~/.local/bin` to your `PATH` to use `tinyhand` and `tinyhand-settings` directly.

## Use on Linux

- Open **TinyHand Settings** from your app launcher, the toolbar gear, or
  `~/.local/bin/tinyhand-settings`. Its macOS-inspired sidebar offers a visual picker for
  **all 37 pointers** (36 hands and a laser), appearance, drawing, and sound controls.
- GNOME **Point** mode permits normal clicks without ink. **Draw** mode captures drags
  to draw without selecting content underneath. Hold **Alt** to interact normally.
- The GNOME toolbar provides pointer previews, Point/Draw, ink colors, sound, clear,
  settings, and hide. Hiding the system cursor is optional in settings.
- X11 captures taps/drags, hides the cursor, and offers a tray menu; hold **Alt** for
  click-through. Tray visibility may require an AppIndicator extension.

| Default shortcut | Action |
| --- | --- |
| Ctrl+Alt+H | Toggle TinyHand |
| Ctrl+Alt+X | Clear ink |
| Ctrl+Alt+P | Next pinned hand / laser |

Both modes share `~/.config/tinyhand/config.json`, with changes reloaded on save.
GNOME shortcuts use the extension's GSettings keys; X11 shortcuts use the JSON config.
See the [configuration reference and troubleshooting](./linux/README.md).

To disable or remove the Linux installation:

```sh
gnome-extensions disable tinyhand@abdulrehmankhan56
./linux/scripts/install.sh --uninstall
```

Uninstall keeps your config; add `--purge` only if you want to delete it too.

## Limitations and verification

Rust tests, offline render/self-tests, companion logic checks, and GTK settings tests
cover parts of the implementation—not every live desktop interaction. Mixed-scale and
multi-monitor setups, shortcut conflicts, click-through, and other extensions need
desktop testing. Custom hands, pin reordering, and a complete hotkey settings UI remain
gaps relative to macOS. See [release notes](./linux/RELEASE_NOTES.md) for the tested scope.

Bug reports and focused patches are welcome; include your session type, GNOME version,
and reproduction steps. This fork is independent: any upstream Linux PR is a proposal,
not an accepted upstream feature or endorsement.

## Original macOS app

For the original TinyHand by Kamran Ahmed, visit [tinyhand.app](https://tinyhand.app) or
[download TinyHand.dmg](https://github.com/nilbuild/tinyhand/releases/latest/download/TinyHand.dmg).
Requires **macOS 13 or later**, Apple Silicon or Intel.

Open the DMG, drag TinyHand to Applications, and allow **Accessibility** when asked.
The original app updates itself. Click the menu bar icon or **⌃⌥H** to toggle;
right-click it for Menu and Settings. Click to tap, hold and drag to draw,
**⌃⌥X** to clear, or **Esc** to clear everything and turn the pointer off.
The bottom toolbar selects one of 36 hands or a laser, mutes sound, or exits.

## License and credits

MIT. The [LICENSE](./LICENSE) retains the original notice unchanged:
**Copyright (c) 2026 Kamran Ahmed**. Keep that notice and the original creator credit
when redistributing this fork, its assets, or substantial portions of the work.
