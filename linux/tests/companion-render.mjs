// Real GJS/Cairo asset smoke test, without enabling a Shell extension.
// Run from repository root: gjs -m linux/tests/companion-render.mjs
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import cairo from 'cairo';

const root = ARGV[0] ?? GLib.get_current_dir();
const extensionRoot = ARGV[1] ?? `${root}/linux/companion/tinyhand@abdulrehmankhan56`;
const Experiment = await import(Gio.File.new_for_path(`${extensionRoot}/experimental.js`).get_uri());
const assetsRoot = ARGV[1] ? `${extensionRoot}/assets` : `${root}/assets`;
const sourcePath = `${extensionRoot}/extension.js`;
const [, bytes] = GLib.file_get_contents(sourcePath);
const source = new TextDecoder().decode(bytes)
    .replace(/^import .*;\n/gm, '')
    .replace('export default class TinyHandExtension', 'class TinyHandExtension');
const stage = {width: 1920, height: 1080};
const TinyHand = new Function('Extension', 'GLib', 'Gio', 'GdkPixbuf', 'cairo', 'global', 'Experiment',
    `${source}\nreturn TinyHandExtension;`)(class {}, GLib, Gio, GdkPixbuf, cairo, {stage}, Experiment);
const ext = new TinyHand();
ext._assetDir = assetsRoot;
ext._assets = new Map();
ext._geometry = {};
// Cache writes are optional; keep this test from changing the user's config/cache.
ext._geometryPath = '/dev/null/tinyhand-test.json';
ext._config = {pointer: {style: 'lavender', size: 0.13, shadow: true}, ink: {fade: 3}};
ext._last = [900, 500];
ext._gripX = 1476;
ext._press = 0;
ext._active = null;
ext._strokes = [{points: [[100, 100], [200, 150], [300, 120]], color: [1, 0, 0],
    start: GLib.get_monotonic_time() / 1e6}];

const [, files] = GLib.spawn_sync(null, ['find', assetsRoot, '-maxdepth', '1', '-name', 'hand_*.png'],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
const styles = new TextDecoder().decode(files).trim().split('\n')
    .map(path => GLib.path_get_basename(path).replace(/^hand_|\.png$/g, ''));
if (styles.length !== 36) throw new Error(`Expected 36 hands, got ${styles.length}`);
for (const style of styles) {
    ext._config.pointer.style = style;
    if (!ext._asset(style)) throw new Error(`Cannot load ${style}`);
    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, stage.width, stage.height);
    const cr = new cairo.Context(surface);
    try {
        ext._paintInk(cr);
        ext._paintHand(cr);
        ext._paintLaser(cr);
    } finally {
        cr.$dispose();
    }
    ext._assets.clear();
}
print(`PASS: ${styles.length} hands, shadows, ink, and laser rendered with GJS/Cairo (not live Shell).`);
ext._config = Experiment.normalizeExperiment({enabled: true, pointer: {size: 0.13},
    ink: {width: 8}, presentation: {enabled: true, spotlight: true},
    accessibility: {highContrast: true}});
ext._ripples = [{x: 900, y: 500, start: GLib.get_monotonic_time() / 1e6}];
const surface = new cairo.ImageSurface(cairo.Format.ARGB32, stage.width, stage.height);
const cr = new cairo.Context(surface);
try {
    ext._paintPresentation(cr);
    for (const tool of ['freehand', 'line', 'arrow']) {
        ext._strokes = [{points: [[100, 100], [250, 200]], color: [1, 1, 0],
            tool, width: 12, start: GLib.get_monotonic_time() / 1e6}];
        ext._paintInk(cr);
    }
    ext._config.accessibility.reducedMotion = true;
    ext._paintPresentation(cr);
    ext._customSurface = new cairo.ImageSurface(cairo.Format.ARGB32, 128, 192);
    ext._paintCustom(cr);
} finally { cr.$dispose(); }
print('PASS: spotlight, ripples, reduced-motion effects, line/arrow tools, high-contrast ink and custom sprite rendered.');
