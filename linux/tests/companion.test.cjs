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
let pointer = [100, 100, 0];
const context = vm.createContext({
    Extension: class {}, TextDecoder, console,
    Main: {overview: {visible: false}},
    global: {stage: {width: 1920, height: 1080}, display: {focus_window: null},
        get_pointer: () => pointer},
    GLib: {get_monotonic_time: () => 10e6,
        file_get_contents: () => [true, Buffer.from(JSON.stringify(disk))]},
});
vm.runInContext(`${source}\nthis.TinyHand = TinyHandExtension; this.mergeConfig = merge;`, context);

test('metadata uses the GNOME integer version format', () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json')));
    assert.equal(Number.isInteger(metadata.version), true);
    assert.ok(metadata['shell-version'].includes('50'));
});

test('companion uses GDK 4 like the GNOME 50 host', () => {
    assert.ok(rawSource.includes("from 'gi://Gdk?version=4.0'"));
    assert.ok(!rawSource.includes('gi://Gdk?version=3.0'));
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
