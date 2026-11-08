# Contributing to the Linux port

TinyHand is the original work of **[Kamran Ahmed (@nilbuild)](https://github.com/nilbuild)**:
[upstream source](https://github.com/nilbuild/tinyhand) · [tinyhand.app](https://tinyhand.app).
[AbdulRehman56](https://github.com/AbdulRehman56) maintains this independent Linux fork.
Retain creator attribution and the unchanged MIT notice, **Copyright (c) 2026 Kamran Ahmed**,
in source distributions, packages, and release materials.

## Scope and setup

Work from the fork's `linux-port` branch. Keep Linux changes in `linux/` where practical;
leave the original macOS source untouched unless a separately explained change is necessary.
Do not claim upstream acceptance or full macOS parity.

```sh
git clone --branch linux-port https://github.com/AbdulRehman56/tinyhand.git
cd tinyhand
cargo build --manifest-path linux/Cargo.toml
```

The X11 app uses pure-Rust dependencies and needs no system development headers.
Use a normal user account, not sudo. Cargo needs access to dependencies on the first
build; `--offline` works only after they are cached. Node.js runs companion logic tests.
GJS rendering/settings checks require the appropriate GNOME libraries; settings needs
GTK 4.8+ and libadwaita 1.4+, and its layout test needs a graphical desktop.

## Development checks

Run from the repository root:

```sh
cargo test --manifest-path linux/Cargo.toml
cargo run --manifest-path linux/Cargo.toml -- --selftest
node --test linux/tests/companion.test.cjs
gjs -m linux/tests/companion-render.mjs
glib-compile-schemas --strict --dry-run linux/companion/tinyhand@abdulrehmankhan56/schemas

# Graphical desktop required; isolate writes from your real settings:
test_config=$(mktemp -d -t tinyhand-layout.XXXXXX)
XDG_CONFIG_HOME="$test_config" gjs -m linux/tests/preferences-layout.mjs
```

The self-test writes sample poses to `/tmp/tinyhand-selftest/`. Inspect rendering and
fingertip alignment as well as exit status. For a cached/offline Rust check, add
`--offline` to the Cargo commands. Report skipped checks and their reasons honestly.

For desktop testing, inspect and run `./linux/scripts/install.sh --extension` as your
normal user, then enable `tinyhand@abdulrehmankhan56`. A new extension directory may
require logout/login before discovery; copied files are not a guarantee of live reload.
Never run the X11 app and companion simultaneously.

## Pull requests and bug reports

- Describe the problem, the change, and how to reproduce or verify it.
- State your distribution, session (GNOME Wayland or X11), GNOME Shell version, display
  scaling/monitor setup, and relevant extension conflicts.
- List exact checks run, results, and untested scope. Metadata targets GNOME 45–50;
  45–49 remain experimental with versioned API/mocked coverage, never claimed as
  desktop-tested. GNOME 50.1 is the only desktop used in development; the latest
  changes have not been hot-loaded. Follow [COMPATIBILITY.md](./COMPATIBILITY.md)
  before promoting a version or raising the GTK/libadwaita minimums.
- For interaction changes, test Point/Draw, Alt pass-through, cursor restoration,
  shortcuts, settings persistence, enable/disable, and sound where applicable.
- For settings changes, test all affected controls and the isolated GTK layout test.
- Keep patches focused. Avoid unrelated formatting, generated build output, or personal config.
- Include screenshots only when captured from the actual implementation; do not imply
  a mockup or offline render proves live Shell behavior.

An upstream PR should clearly describe this as an optional, experimental Linux port,
credit the original creator, explain packaging and dependencies, and separate verified
behavior from remaining gaps. Submit only the tested scope; upstream review and acceptance
remain the original project's decision.

## Release checklist

Keep [release notes](./RELEASE_NOTES.md) accurate and preserve attribution in every artifact.
Verify install/uninstall in a clean per-user environment before publishing packages.
The initial prerelease tag was `v1.0.2-linux.1`; the extension ZIP and Linux tarball
installer must be built and checked before being advertised as downloadable. The ZIP
should be self-contained, with resized alpha artwork for Shell rendering; leave source
artwork unchanged. The portable tarball installer should not require Cargo.
Use native Shell preferences launching and sound playback; do not introduce a Gdk import
into Shell code. Preferences previews and X11 audio may still require `paplay`.
The prepared publication can be run with `./linux/scripts/publish.sh` from a
`linux-port` checkout with an authenticated GitHub CLI and a writable `.git` directory.
It commits only the listed publication files, refuses unrelated or staged changes,
sets the fork's default branch and waits for the release workflow. Upstream PR work
is paused: no upstream branch or draft is changed unless `--upstream-pr` is explicitly
requested. That opt-in prepares/pushes the upstream branch and opens a draft PR.
The script leaves an existing release unchanged. The tag comes from `linux/VERSION`
with a `v` prefix. GNOME's human-readable `version-name` permits only letters,
digits, spaces and dots, not semver hyphens. Update `linux/VERSION`, that display
field, the integer extension version, and release notes together for each follow-up. The workflow builds
on Ubuntu 24.04 and only publishes after its verification job succeeds.
The [GNOME Extensions listing](https://extensions.gnome.org/extension/11682/tinyhand-for-gnome/)
is submitted and awaiting review. Do not add an approved badge or claim store
installation availability before approval and publication.
