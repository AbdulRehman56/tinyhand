# Local GNOME toolkit experiment

This toolkit was developed on `experiment/gnome-toolkit-local` without publication.
The user subsequently authorized publication and installation as `v1.0.2-linux.5`.
The isolated preview launchers remain available for testing without replacing a live extension.
The macOS app and experimental X11 runtime are outside this feature work.

## Implementation stages

1. Shared policy: validated opt-in presentation/accessibility settings, profiles,
   exact per-app rules, monitor-safe normalized toolbar coordinates.
2. Shell tools: spotlight, click ripples, privacy-safe modifier/shortcut display;
   freehand/line/arrow drawing, undo and persistent ink; movable/collapsible toolbar.
3. Visual settings: profiles, per-app rules, shortcut editor, PNG import/preview,
   accessibility and volume controls. Preserve the existing gallery and sidebar.
4. Verification: policy/runtime mocks, actual GTK controls, Cairo render checks,
   strict schemas, local package content. No automatic live extension replacement.

## Safety and design constraints

- Effects and app rules are opt-in; Point mode stays click-through.
- Never display ordinary typed text or retain keystroke history. Shortcut display
  shows only modifiers and a small allowlist of navigation/function keys; suppress
  it during password prompts, lock/session modes, overview, and settings interaction.
- Per-app profiles are ephemeral overrides, not repeated writes to shared config.
- Imported artwork lives in the user data directory, never in original assets.
- Toolbar placement is clamped to a current monitor's usable area; settings offer
  positioning controls and a reset alternative to dragging.
- Existing GNOME review warnings are not claimed fixed by this feature experiment.

## Documentation / allowed APIs

Existing Shell patterns: extension.js `_connect`, `_sources`, `_paintInk`,
`_positionToolbar`, `_hideSystemCursor`; settings patterns: preferences.js `save`,
`slider`, `switchRow`, `combo`, `cleanup`. Preserve lifecycle tracking and private
atomic configuration writes. GTK stays in preferences, never in the Shell entry.
Further API discovery evidence and verification results are recorded below as work
is completed.

Allowed API references (discovery checked against GNOME 45/50 event headers):
- [Clutter captured-event](https://mutter.gnome.org/clutter/signal.Actor.captured-event.html):
  fixed key-symbol allowlist; always propagate keyboard input outside an active drag.
- [Stage.grab](https://mutter.gnome.org/clutter/method.Stage.grab.html) and
  [Grab.dismiss](https://mutter.gnome.org/clutter/method.Grab.dismiss.html): temporary
  toolbar drag grab, dismissed on release, Escape, resize, hide, session change, disable.
- [FileChooserNative](https://docs.gtk.org/gtk4/ctor.FileChooserNative.new.html):
  compatible with GTK 4.8; no unguarded GTK 4.10 FileDialog requirement.
- [Gtk.accelerator_parse](https://docs.gtk.org/gtk4/func.accelerator_parse.html):
  GTK4 returns `[ok, keyval, modifiers]`; parsing does not guarantee desktop availability.

## Try the settings safely

**To see the hand and test drawing in a separate desktop window:**

```sh
./linux/scripts/preview-shell.sh
```

This rebuilds the local experiment and starts GNOME Shell's windowed devkit with
private config, data, runtime directory, and D-Bus session. The hand appears **inside
the test window only**, not across your main desktop. Move the pointer into that
window; if Activities is open, click the desktop to leave the overview. Use the
toolbar gear for sandbox settings, switch Point to Draw for ink, or hold Alt to
interact normally. Close the test window or press Ctrl+C in the launching terminal
to stop. This requires the installed GNOME/Mutter devkit backend.

**For settings only (no hand or overlay):**

```sh
./linux/scripts/preview-experiment.sh
```

This opens source settings with independent config, data and cache under
`~/.local/state/tinyhand-experiment/`. It does **not** install/enable the extension,
replace live configuration, or activate runtime effects on your desktop. Shortcuts
use an in-memory GSettings backend in this preview and reset when it closes.
`TINYHAND_EXPERIMENT_HOME=/some/path` changes the sandbox location.

Actual Shell input routing (especially shortcut display), drag grabs, and mixed-DPI
behavior still need live desktop testing before this experiment is release-ready.
The modifier/navigation-key display is best-effort, never a global text recorder.
Custom PNGs use one managed sprite slot with adjustable cursor anchors, rather than
automatic reconstruction of the original hand-and-stick geometry. Named profiles
reference the current custom slot; they do not archive imported artwork.

## Verified locally

- 46 Node checks (existing compatibility checks plus new policy, privacy and drag tests).
- 9 Rust regression tests; no X11 runtime feature changes.
- Actual GTK tests: all seven sidebar sections, gallery/search/pins, profiles and
  deletion confirmations, app rules, shortcut validation and isolated GSettings
  writes, normalized PNG validation, accessibility and toolkit controls.
- Cairo renders: all 36 original hands plus laser, spotlight, ripples, freehand,
  line/arrow tools, high-contrast ink, reduced motion and custom sprite path.
- Local ZIP includes the shared module, original license/credits and XML-only
  schemas; strict schema validation and render checks pass on the unpacked ZIP.
- Isolated launcher smoke test passes with GTK criticals treated as fatal.
- Real, separate headless GNOME Shell 50.1: extension becomes ACTIVE, processes
  atomic config saves and toolbar collapse/rebuild, disables and re-enables without
  TinyHand runtime errors. This does not test hands-on input delivery or mixed DPI.

To repeat the real Shell smoke check after building the local experiment ZIP:

```sh
python3 linux/tests/shell-smoke.py
```

It uses a new D-Bus session and private HOME/XDG directories under `/tmp/opencode`,
starts a headless Shell, and terminates only that child Shell when finished. Logs
and isolated configuration are retained in the printed test directory.

The tests themselves do not replace a live extension, push, publish or submit to GNOME.
Build artifact: `linux/dist/tinyhand@abdulrehmankhan56.shell-extension.zip`.
