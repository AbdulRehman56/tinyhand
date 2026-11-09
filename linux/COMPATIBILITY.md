# GNOME compatibility and maintenance

The extension targets GNOME Shell **45–50**. **45–49 are experimental**: their
versioned APIs were inspected and our fallbacks are covered by automated mocks,
but those desktops have not been run or tested here. GNOME **50.1** is the only
desktop used during development. The toolkit additionally passed a separate real
GNOME 50.1 session's load, atomic-config-reload, toolbar-rebuild and disable/re-enable
checks. This does not establish hands-on input or mixed-DPI compatibility. No
cross-distribution or full macOS parity claim is made.

## Versioned API assessment

| GNOME | Cursor tracker lookup | Cursor visibility | Evidence |
| --- | --- | --- | --- |
| 45 | `Meta.CursorTracker.get_for_display(global.display)` | Save visibility; `set_pointer_visible`; restore saved value | Versioned headers + mock; no live test |
| 46 | Display lookup | Legacy setter | Versioned headers + mock; no live test |
| 47 | Display lookup | Legacy setter | Versioned headers + mock; no live test |
| 48 | `global.backend.get_cursor_tracker()` | Legacy setter | Versioned headers + mock; no live test |
| 49 | Backend lookup | Balanced `inhibit_cursor_visibility` / `uninhibit_cursor_visibility` | Versioned headers + mock; no live test |
| 50 | Backend lookup | Balanced inhibitor | Versioned headers + mock; installed Mutter 18 API check; 50.1 desktop development and separate real-Shell toolkit smoke test |

The adapter detects capabilities, rather than parsing a distribution's version
string. It prefers the backend lookup, falls back to the display API, and keeps
the system cursor unchanged when neither API is available. Modern inhibition is
acquired only once and released when disabled or when Alt enables pass-through.
The legacy setter restores the visibility observed before TinyHand hid it;
it cannot coordinate concurrent cursor changes as reliably as the new inhibitor.
Disable cursor hiding in settings if another extension controls cursor visibility.

All six Mutter versions expose the same sound call:
`display.get_sound_player().play_from_file(file, description, cancellable)`.
No guessed argument-count fallback is used. Full-volume taps use this native API;
reduced-volume taps use bounded `paplay` subprocesses because the native call has no
per-play volume parameter. Playback is optional; missing sound support does not stop
drawing. The cancellable and remaining audio subprocesses are cleaned up during disable.

Shell code uses Cairo and GdkPixbuf, never imports GTK/Gdk/libadwaita, and draws
through `St.DrawingArea`'s repaint/context APIs. Those APIs were checked in the
45.0 and 50.0 headers. ESM extension and preference entry points are available
from GNOME 45. Preferences open through the extension's `openPreferences()`.

## Preferences baseline

Settings require **GTK 4.8+ and libadwaita 1.4+**, independently of the Shell
version. `Gtk.Picture.content-fit` appeared in 4.8; `Adw.SwitchRow` appeared in
1.4. The preferences builder reports these minimums before building its UI if
the dependencies are too old. A Shell metadata version does not guarantee the
distribution has the necessary settings libraries.

`Adw.PreferencesWindow` and the page/group APIs predate this baseline. Although
PreferencesWindow is deprecated since libadwaita 1.6, it remains available and
matches GNOME's extension-preferences window contract. Replacing it with a
dialog would require a separate standalone-settings migration and cannot be
assumed compatible with older Shell preferences hosts.

## Checks and release policy

- `node linux/tests/companion.test.cjs` runs each 45–50 API shape through lookup,
  cursor hiding/restoration, sound arguments and repeated disable. It also tests
  preservation of an already hidden cursor, absent APIs, and dependency errors.
- Rust tests and rendering self-tests exercise the independent X11 implementation.
- CI pins Rust 1.94.1, uses `Cargo.lock`, and uses Ubuntu 24.04 to build the x86_64
  binary against a lower glibc baseline
  than the maintainer's local glibc 2.43. The included `BUILD-INFO.txt` records the
  actual build host. This is not a statically linked, universal Linux binary.
- Archive timestamps are normalized (`SOURCE_DATE_EPOCH` may override the default).
  CI compares two extension builds in the same environment. Reproducing bytes
  across different Pillow/zlib/compiler versions is not promised.
- CI renders all 36 hands from the actual unpacked extension ZIP and runs GTK
  settings/layout under Xvfb. These do not emulate a GNOME compositor or establish
  live input, shortcut, cursor, scaling or other-extension compatibility.
- The ZIP bundles resized alpha artwork, sounds, schemas, license and credits;
  it needs neither the Rust binary nor a separately cloned source/assets tree.
- Each schema is in its own matching XML file. GNOME 45+ compiles schemas at install
  time; the ZIP deliberately omits `gschemas.compiled`. Capability-guarded legacy
  cursor calls can produce a static-analysis false positive for the 49+ target even
  though that branch is not reached on modern Mutter.
- Release tags and assets are immutable in the publication workflow. For a
  compatibility change after publication, increment the extension integer/version
  name and `linux/VERSION` release tag, update notes, and publish a new prerelease. Never silently
  replace an existing tag's assets.
- Before promoting an older GNOME version from experimental, test enable/disable,
  Point/Draw, Alt pass-through, cursor restoration, shortcuts, audio and settings
  on that actual desktop, recording distribution and library versions.

## Primary sources inspected

Mutter cursor headers:
[45.0](https://github.com/GNOME/mutter/blob/45.0/src/meta/meta-cursor-tracker.h),
[46.0](https://github.com/GNOME/mutter/blob/46.0/src/meta/meta-cursor-tracker.h),
[47.0](https://github.com/GNOME/mutter/blob/47.0/src/meta/meta-cursor-tracker.h),
[48.0](https://github.com/GNOME/mutter/blob/48.0/src/meta/meta-cursor-tracker.h),
[49.0](https://github.com/GNOME/mutter/blob/49.0/src/meta/meta-cursor-tracker.h),
[50.0](https://github.com/GNOME/mutter/blob/50.0/src/meta/meta-cursor-tracker.h).
Corresponding `meta-backend.h` and `meta-sound-player.h` headers were inspected
at each of those tags; display sound-player getters were checked at 45.0/50.0.

Shell drawing:
[45.0](https://github.com/GNOME/gnome-shell/blob/45.0/src/st/st-drawing-area.h),
[50.0](https://github.com/GNOME/gnome-shell/blob/50.0/src/st/st-drawing-area.h).
Entry points and preferences:
[GNOME 45 porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-45.html),
[45.0 Extension class](https://github.com/GNOME/gnome-shell/blob/45.0/js/extensions/extension.js).
Widget requirements:
[SwitchRow](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1-latest/class.SwitchRow.html),
[PreferencesWindow](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1-latest/class.PreferencesWindow.html),
[Picture.content-fit](https://docs.gtk.org/gtk4/property.Picture.content-fit.html).
