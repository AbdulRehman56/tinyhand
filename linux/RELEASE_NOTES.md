# Linux release notes

## v1.0.2-linux.2 — GNOME submission compatibility

- Separate the human-readable GNOME version (`1.0.2 Linux 2`) from the GitHub
  prerelease tag in `linux/VERSION`. GNOME rejects hyphens in its version-name field.
- Packaging and regression checks now enforce the store's version-name character set.
- No runtime behavior changes. The earlier `v1.0.2-linux.1` artifacts remain unchanged.
- Submitted to [GNOME Extensions](https://extensions.gnome.org/extension/11682/tinyhand-for-gnome/),
  [review 78099](https://extensions.gnome.org/review/78099). Status at submission: **Unreviewed**,
  not approved. Store download/install availability depends on GNOME review.

## v1.0.2-linux.1 — initial experimental prerelease

Check the fork's [releases page](https://github.com/AbdulRehman56/tinyhand/releases)
for publication status and downloads. Packages comprise a self-contained GNOME extension
ZIP, an x86_64 X11 tarball with a per-user installer, and `SHA256SUMS`. Installation
requires no Cargo. The ZIP bundles 36 resized RGBA hands and six original sounds without
changing source assets. The follow-up `v1.0.2-linux.2` was submitted to GNOME Extensions;
see its review status above. Submission is not approval.

GitHub Actions builds the X11 binary on Ubuntu 24.04 (glibc 2.39). Check the included
`BUILD-INFO.txt` for the actual build host and architecture. Older glibc systems should
build from source. Locally built artifacts may require newer glibc than CI artifacts.

### Credits and license

TinyHand was created by **[Kamran Ahmed (@nilbuild)](https://github.com/nilbuild)**.
The original project is [nilbuild/tinyhand](https://github.com/nilbuild/tinyhand), with
the original app at [tinyhand.app](https://tinyhand.app).
This independent Linux port is maintained by [AbdulRehman56](https://github.com/AbdulRehman56).
The MIT license and **Copyright (c) 2026 Kamran Ahmed** remain unchanged.
This is not an upstream-endorsed or accepted Linux release.

### Included

- GNOME Shell companion for Wayland targeting **GNOME Shell 45–50**; 45–49 are
  experimental and have not been desktop-tested.
- Capability-based cursor tracker lookup (display on 45–47, backend on 48+),
  balanced visibility inhibition on 49+, and saved visibility restoration on 45–48.
- Clear settings dependency errors for GTK below 4.8 or libadwaita below 1.4.
- Native GNOME preferences release Draw-mode capture while TinyHand Settings is
  focused, so settings controls can be used without holding Alt.
- Point mode for normal clicks and Draw mode for captured drawing, Alt pass-through,
  optional system-cursor hiding, and an on-screen toolbar.
- macOS-inspired GTK4/libadwaita settings with all **37 pointers**, appearance,
  ink, and sound controls, sharing `~/.config/tinyhand/config.json` with the Rust app.
- Experimental Rust X11 overlay, click capture, tap sounds, tray menu, and shortcuts.
- Per-user source installer and uninstall support; no sudo needed. New extension
  directories may require the next login before Shell discovers them.

### Verification scope

**GNOME 50.1 is the only desktop-tested GNOME version.** Metadata targets 45–50;
45–49 have versioned API review and automated mocks only. The latest compatibility
changes were not hot-loaded into the active desktop. Installed Mutter 18/Cairo APIs
were checked by introspection; this is not a fresh live input or compositor test.
See [COMPATIBILITY.md](./COMPATIBILITY.md) for the evidence and version matrix.
The X11 path remains experimental; do not infer broad desktop certification.

Verification includes offline Rust tests and rendering self-tests, Node companion logic
checks, GJS rendering checks, schema validation, and GTK settings/layout tests.
The current local suite passes 9 Rust tests and 23 Node tests, including all six
version-shaped cursor/sound/disable fixtures and settings dependency errors.
GJS rendered all 36 hands with the latest Cairo-only Shell code, and the GTK settings
layout/save tests passed again on the maintainer's desktop. The release pipeline
repeats these checks, renders the unpacked extension ZIP, and verifies tarball
install/uninstall with an isolated home directory. A passing pipeline is required
before automated release publication.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for reproducible commands. Offline Cargo runs
require cached dependencies. These checks are not substitutes for live Shell input tests
and do not prove click-through or shortcut behavior across all desktops.

### Known gaps and cautions

- Not full macOS parity: custom hands, pin reordering, and a complete hotkey settings
  UI are not implemented. GNOME hotkeys use GSettings; X11 hotkeys use JSON config.
- Mixed-scale/multi-monitor layouts and other GNOME versions need further testing.
  Whole-stage sizing/anchoring and minimum rod length can affect fingertip alignment.
- Very quick clicks can be missed by pointer polling. Shortcut conflicts and interaction
  with other Shell extensions require desktop testing.
- Use the companion on GNOME Wayland, not the Rust overlay inside XWayland; do not run
  both modes together. Other Wayland compositors have no native integration here.
- X11 tray visibility may require AppIndicator support. X11 tap sounds and preferences
  sound previews require `paplay`; Shell sounds use `Meta.SoundPlayer` instead.
- Copying updated extension files does not promise immediate live hot-loading.

Install from source using the [root README](../README.md); consult the
[Linux technical guide](./README.md) for configuration and troubleshooting.
