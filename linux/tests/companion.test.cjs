// Offline logic checks; these do not replace testing inside GNOME Shell.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../companion/tinyhand@abdulrehmankhan56');
const rawSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
const source = rawSource
    .replace(/^import .*;\n/gm, '')
    .replace('export default class TinyHandExtension', 'class TinyHandExtension');
let disk = {};
let rawDisk = null;
let pointer = [100, 100, 0];
const context = vm.createContext({
    Extension: class {}, TextDecoder, console,
    Main: {overview: {visible: false}},
    global: {stage: {width: 1920, height: 1080}, display: {focus_window: null},
        get_pointer: () => pointer},
    GLib: {get_monotonic_time: () => 10e6,
        file_get_contents: () => [true, Buffer.from(rawDisk ?? JSON.stringify(disk))],
        file_test: () => true, FileTest: {EXISTS: 1}},
});
vm.runInContext(`${source}\nthis.TinyHand = TinyHandExtension; this.mergeConfig = merge; this.readConfigJson = readJson;`, context);

test('metadata uses the GNOME integer version format', () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json')));
    assert.equal(Number.isInteger(metadata.version), true);
    assert.equal(metadata.name, 'TinyHand');
    assert.ok(metadata['shell-version'].includes('50'));
    assert.match(metadata['version-name'], /^[A-Za-z0-9. ]+$/, 'GNOME store rejects hyphenated version names');
});

test('Shell entry point never imports GTK libraries', () => {
    assert.ok(!/from ['"]gi:\/\/(Gdk(?:[?'\"])|Gtk|Adw)/.test(rawSource));
});

test('each GSettings schema is shipped in the file named for its schema ID', () => {
    const schemaDir = path.join(root, 'schemas');
    for (const name of fs.readdirSync(schemaDir).filter(name => name.endsWith('.gschema.xml'))) {
        const xml = fs.readFileSync(path.join(schemaDir, name), 'utf8');
        const ids = [...xml.matchAll(/<schema\s+id="([^"]+)"/g)].map(match => match[1]);
        assert.equal(ids.length, 1);
        assert.equal(name, `${ids[0]}.gschema.xml`);
    }
});

test('repeated runtime failures log only once per category', () => {
    const ext = new context.TinyHand();
    const previousConsole = context.console;
    const messages = [];
    try {
        context.console = {warn: message => messages.push(message)};
        ext._warn('paint failed', 'first');
        ext._warn('paint failed', 'again');
        ext._warn('update failed', 'other');
        assert.equal(messages.length, 2);
        assert.match(messages[0], /paint failed: first/);
    } finally { context.console = previousConsole; }
});

test('partial config falls back safely and clamps hand size', () => {
    disk = {pointer: {size: 999}, ink: null, enabled: null, custom: 'preserve'};
    const config = new context.TinyHand()._readConfig();
    assert.equal(config.pointer.size, 0.20);
    assert.equal(config.pointer.style, 'lavender');
    assert.equal(config.ink.fade, 3);
    assert.equal(config.enabled, true);
    assert.equal(config.custom, 'preserve');
});

test('merge preserves unknown nested settings without sharing defaults', () => {
    const base = {pointer: {style: 'robot', custom: 7}};
    const merged = context.mergeConfig(base, {pointer: {style: 'laser'}});
    assert.equal(merged.pointer.style, 'laser');
    assert.equal(merged.pointer.custom, 7);
    assert.equal(base.pointer.style, 'robot');
});

test('ink holds, fades, expires, and supports permanent strokes', () => {
    const ext = new context.TinyHand();
    ext._config = {ink: {fade: 3}};
    ext._active = null;
    const stroke = {start: 0};
    assert.equal(ext._alpha(stroke, 2), 1);
    assert.ok(Math.abs(ext._alpha(stroke, 3.3) - 0.5) < 1e-8);
    assert.equal(ext._alpha(stroke, 4), 0);
    ext._config.ink.fade = 0;
    assert.equal(ext._alpha(stroke, 1000), 1);
});

test('style cycling wraps through pinned hands and laser', () => {
    const ext = new context.TinyHand();
    ext._config = {pointer: {style: 'robot'}};
    ext._update = patch => { ext._config.pointer.style = patch.pointer.style; };
    ext._cycle();
    assert.equal(ext._config.pointer.style, 'laser');
    ext._cycle();
    assert.equal(ext._config.pointer.style, 'lavender');
});

test('custom toolbar pins reject invalid values and deduplicate with a six-pin limit', () => {
    const ext = new context.TinyHand();
    ext._config = {toolbar: {pinnedStyles: ['mint', 'mint', null, {}, '__proto__', 'robot',
        'cookie', 'blue', 'laser', 'coral', 'glove']}};
    assert.deepEqual(Array.from(ext._pinnedStyles()), ['mint', 'robot', 'cookie', 'blue', 'laser', 'coral']);
    ext._config.toolbar.pinnedStyles = [];
    assert.deepEqual(Array.from(ext._pinnedStyles()), []);
    ext._config.toolbar.pinnedStyles = 'invalid';
    assert.equal(ext._pinnedStyles().length, 6);
});

test('keyboard cycling uses custom pins and safely handles an empty toolbar', () => {
    const ext = new context.TinyHand();
    ext._config = {pointer: {style: 'mint'}, toolbar: {pinnedStyles: ['mint', 'cookie']}};
    ext._update = patch => { ext._config.pointer.style = patch.pointer.style; };
    ext._cycle();
    assert.equal(ext._config.pointer.style, 'cookie');
    ext._cycle();
    assert.equal(ext._config.pointer.style, 'mint');
    ext._config.toolbar.pinnedStyles = [];
    ext._cycle();
    assert.equal(ext._config.pointer.style, 'lavender');
});

test('toolbar rebuild includes the selected unpinned hand and destroys stale controls', () => {
    context.St = {Icon: class {}};
    const ext = new context.TinyHand();
    ext._config = {pointer: {style: 'cookie'}, toolbar: {pinnedStyles: ['mint']}};
    ext._shownStyles = null;
    ext._styleSignals = [];
    ext._styleButtons = new Map();
    const children = [];
    let destroyed = 0, disconnected = 0;
    ext._styleBox = {get_children: () => [...children]};
    ext._thumbnail = () => null;
    ext._toolbarButton = () => {
        const actor = {destroy() { destroyed++; children.splice(children.indexOf(actor), 1); },
            disconnect() { disconnected++; }};
        children.push(actor);
        ext._styleSignals.push([actor, 1]);
        return actor;
    };
    ext._rebuildStyleButtons();
    assert.deepEqual([...ext._styleButtons.keys()], ['mint', 'cookie']);
    ext._rebuildStyleButtons();
    assert.equal(destroyed, 0);
    ext._config.pointer.style = 'mint';
    ext._rebuildStyleButtons();
    assert.deepEqual([...ext._styleButtons.keys()], ['mint']);
    assert.equal(destroyed, 2);
    assert.equal(disconnected, 2);
    delete context.St;
});

test('strict configuration reads protect malformed JSON and non-object settings', () => {
    try {
        rawDisk = '{';
        assert.throws(() => context.readConfigJson('/config.json', true));
        assert.equal(Object.keys(context.readConfigJson('/config.json')).length, 0);
        rawDisk = '[]';
        assert.throws(() => context.readConfigJson('/config.json', true), /JSON object/);
    } finally { rawDisk = null; }
});

test('malformed config reload preserves the currently active settings', () => {
    const ext = new context.TinyHand();
    const settings = {pointer: {style: 'mint'}, interaction: {mode: 'draw'}};
    const previousConsole = context.console;
    ext._config = settings;
    ext._configPath = '/config.json';
    try {
        context.console = {warn() {}};
        rawDisk = '{';
        ext._reload();
        assert.equal(ext._config, settings);
    } finally {
        rawDisk = null;
        context.console = previousConsole;
    }
});

test('config monitoring debounces atomic-save events and removes its completed source', () => {
    const pending = new Map();
    let sequence = 0, reloads = 0;
    context.GLib.timeout_add = (_priority, _delay, callback) => {
        pending.set(++sequence, callback);
        return sequence;
    };
    context.GLib.source_remove = id => pending.delete(id);
    const ext = new context.TinyHand();
    ext._sources = new Set();
    ext._running = true;
    ext._reloadSource = 0;
    ext._reload = () => { reloads++; };
    ext._queueReload();
    ext._queueReload();
    assert.equal(pending.size, 1);
    assert.equal(ext._sources.size, 1);
    pending.get(sequence)();
    assert.equal(reloads, 1);
    assert.equal(ext._sources.size, 0);
    assert.equal(ext._reloadSource, 0);
    delete context.GLib.timeout_add;
    delete context.GLib.source_remove;
});

test('toolbar stays in the primary work area and shrinks safely on small displays', () => {
    const monitor = {index: 1, x: 1920, y: 0, width: 1280, height: 720};
    let area = {x: 1920, y: 24, width: 1280, height: 660};
    context.Main.layoutManager = {primaryMonitor: monitor};
    context.global.workspace_manager = {get_active_workspace: () => ({get_work_area_for_monitor: () => area})};
    const actor = (width, height) => ({visible: true, width, height, scale: 1,
        set_scale(value) { this.scale = value; }, set_position(x, y) { this.x = x; this.y = y; },
        get_transformed_position() { return [this.x, this.y]; },
        get_transformed_size() { return [this.width * this.scale, this.height * this.scale]; }});
    const ext = new context.TinyHand();
    ext._toolbar = actor(900, 54);
    ext._inkTray = actor(400, 44);
    ext._positionToolbar();
    assert.ok(ext._toolbar.x >= area.x);
    assert.ok(ext._toolbar.y + 54 <= area.y + area.height);
    area = {...area, width: 400};
    ext._positionToolbar();
    assert.ok(ext._toolbar.scale < 1);
    assert.ok(ext._toolbar.x + 900 * ext._toolbar.scale <= area.x + area.width);
    assert.equal(ext._overControls(ext._toolbar.x + 5, ext._toolbar.y + 5), true);
    assert.equal(ext._overControls(ext._toolbar.x + 1000, ext._toolbar.y + 5), false);
    delete context.Main.layoutManager;
    delete context.global.workspace_manager;
});

function tickingExtension(mode) {
    const ext = new context.TinyHand();
    ext._config = {enabled: true, pointer: {style: 'lavender'}, ink: {choice: 'match', fade: 3},
        interaction: {mode, hideCursor: true}, sound: {hand: false, laser: false}};
    ext._gripX = null;
    ext._last = null;
    ext._held = false;
    ext._press = 0;
    ext._strokes = [];
    ext._active = null;
    ext._dirty = true;
    ext._area = {reactive: false, queue_repaint() {}};
    ext._overControls = () => false;
    ext._hideSystemCursor = hide => { ext.cursorHidden = hide; };
    return ext;
}

test('Point mode never draws or captures normal application clicks', () => {
    pointer = [100, 100, 0x100];
    const ext = tickingExtension('point');
    ext._tick();
    assert.equal(ext._area.reactive, false);
    assert.equal(ext._strokes.length, 0);
    assert.equal(ext.cursorHidden, true);
});

test('Draw mode captures pointer input; Alt releases it and restores cursor', () => {
    pointer = [100, 100, 0x100];
    const ext = tickingExtension('draw');
    ext._tick();
    assert.equal(ext._area.reactive, true);
    assert.equal(ext._strokes.length, 1);
    assert.equal(ext.cursorHidden, true);
    pointer = [120, 120, 0x108];
    ext._tick();
    assert.equal(ext._area.reactive, false);
    assert.equal(ext._active, null);
    assert.equal(ext.cursorHidden, false);
});

for (const [name, appId, title, captured] of [
    ['native TinyHand preferences', 'org.gnome.Shell.Extensions', 'TinyHand Settings', false],
    ['standalone TinyHand settings', 'io.github.AbdulRehman56.TinyHand.Settings', 'TinyHand Settings', false],
    ['another extension preferences window', 'org.gnome.Shell.Extensions', 'Other Settings', true],
    ['unrelated app with the same title', 'org.example.Editor', 'TinyHand Settings', true],
]) {
    test(`Draw mode handles focused ${name}`, () => {
        context.global.display.focus_window = {get_gtk_application_id: () => appId, get_title: () => title};
        try {
            pointer = [100, 100, 0x100];
            const ext = tickingExtension('draw');
            ext._tick();
            assert.equal(ext._area.reactive, captured);
            assert.equal(ext.cursorHidden, captured);
            assert.equal(ext._strokes.length, captured ? 1 : 0);
        } finally {
            context.global.display.focus_window = null;
        }
    });
}

test('cursor visibility inhibition is balanced, including repeated ticks', () => {
    const ext = new context.TinyHand();
    let hides = 0, restores = 0;
    ext._cursorHidden = false;
    ext._cursorTracker = {inhibit_cursor_visibility() { hides++; },
        uninhibit_cursor_visibility() { restores++; }};
    ext._hideSystemCursor(true);
    ext._hideSystemCursor(true);
    ext._hideSystemCursor(false);
    ext._hideSystemCursor(false);
    assert.equal(hides, 1);
    assert.equal(restores, 1);
});

// Shapes come from the versioned Mutter headers linked in COMPATIBILITY.md.
// These exercise our adapter, not a live compositor or those upstream APIs.
function versionFixture(version, initiallyVisible = true) {
    let visible = initiallyVisible;
    let inhibits = 0;
    const calls = [];
    const tracker = {get_pointer_visible: () => visible};
    if (version >= 49) {
        tracker.inhibit_cursor_visibility = () => { inhibits++; };
        tracker.uninhibit_cursor_visibility = () => { inhibits--; };
    } else {
        tracker.set_pointer_visible = value => { visible = value; };
    }
    const display = {get_sound_player: () => ({play_from_file: (...args) => calls.push(args)})};
    const backend = version >= 48 ? {get_cursor_tracker: () => tracker} : {};
    const Meta = {CursorTracker: version < 48 ? {get_for_display: value => {
        assert.equal(value, display);
        return tracker;
    }} : {}};
    const context = vm.createContext({Extension: class {}, console, TextDecoder, Meta,
        Main: {}, global: {display, backend},
        GLib: {build_filenamev: paths => paths.join('/'), file_test: () => true,
            FileTest: {IS_REGULAR: 1}},
        Gio: {File: {new_for_path: filePath => ({path: filePath})}},
    });
    vm.runInContext(`${source}\nthis.TinyHand = TinyHandExtension;`, context);
    const ext = new context.TinyHand();
    ext._cursorHidden = false;
    ext._soundCancellable = {cancelled: false, cancel() { this.cancelled = true; }};
    return {ext, tracker, calls, context, visible: () => visible, inhibits: () => inhibits};
}

for (const version of [45, 46, 47, 48, 49, 50]) {
    test(`GNOME ${version} API shape: lookup, cursor restoration, sound and disable`, () => {
        const fixture = versionFixture(version);
        const {ext, tracker, calls} = fixture;
        ext._cursorTracker = ext._getCursorTracker();
        assert.equal(ext._cursorTracker, tracker);
        ext._hideSystemCursor(true);
        ext._hideSystemCursor(true);
        assert.equal(version >= 49 ? fixture.inhibits() : fixture.visible(), version >= 49 ? 1 : false);
        ext._assetDir = '/bundled/assets';
        ext._config = {pointer: {style: 'lavender'}, sound: {hand: true, tap: 'thock'}};
        const cancellable = ext._soundCancellable;
        ext._tap();
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0].path, '/bundled/assets/sounds/tap_thock.wav');
        assert.equal(calls[0][1], 'TinyHand tap');
        assert.equal(calls[0][2], cancellable);
        ext.disable();
        ext.disable();
        assert.equal(fixture.inhibits(), 0);
        assert.equal(fixture.visible(), true);
        assert.equal(cancellable.cancelled, true);
        assert.equal(ext._cursorTracker, null);
    });
}

test('legacy cursor restoration preserves a cursor already hidden by another client', () => {
    const fixture = versionFixture(45, false);
    fixture.ext._cursorTracker = fixture.ext._getCursorTracker();
    fixture.ext._hideSystemCursor(true);
    fixture.ext._hideSystemCursor(false);
    assert.equal(fixture.visible(), false);
});

test('absent cursor and sound APIs degrade without preventing drawing', () => {
    const fixture = versionFixture(50);
    fixture.context.global.backend = {};
    fixture.context.Meta.CursorTracker = {};
    fixture.context.global.display = {};
    fixture.ext._cursorTracker = fixture.ext._getCursorTracker();
    assert.equal(fixture.ext._cursorTracker, null);
    fixture.ext._hideSystemCursor(true);
    assert.equal(fixture.ext._cursorHidden, false);
    fixture.ext._assetDir = '/bundled/assets';
    fixture.ext._config = {pointer: {style: 'lavender'}, sound: {hand: true, tap: 'thock'}};
    assert.doesNotThrow(() => fixture.ext._tap());
});

const preferencesSource = fs.readFileSync(path.join(root, 'preferences.js'), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export function buildPreferences', 'function buildPreferences')
    .replaceAll('import.meta.url', "'file:///test/preferences.js'");
for (const [name, Gtk, Adw] of [
    ['GTK before 4.8', {check_version: () => 'GTK too old'}, {SwitchRow: class {}}],
    ['libadwaita before 1.4', {check_version: () => null}, {}],
]) {
    test(`preferences explain missing minimum dependency: ${name}`, () => {
        const build = new Function('Gtk', 'Adw', `${preferencesSource}\nreturn buildPreferences;`)(Gtk, Adw);
        assert.throws(() => build({}), /GTK 4\.8.*libadwaita 1\.4/);
    });
}
