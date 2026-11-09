const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../companion/tinyhand@abdulrehmankhan56');
const modelSource = fs.readFileSync(path.join(root, 'experimental.js'), 'utf8').replace(/^export /gm, '');
const Model = new Function(`${modelSource}\nreturn {normalizeExperiment, snapshotProfile, profilePatch, appOverride, toolbarPosition};`)();
const extensionSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class TinyHandExtension', 'class TinyHandExtension');
const Main = {overview: {visible: false}, sessionMode: {currentMode: 'user'}};
const Clutter = {EventType: {KEY_PRESS: 1, BUTTON_RELEASE: 2, MOTION: 3},
    ModifierType: {CONTROL_MASK: 4, MOD1_MASK: 8, SHIFT_MASK: 1, SUPER_MASK: 64},
    KEY_Control_L: 101, KEY_Control_R: 102, KEY_Alt_L: 103, KEY_Alt_R: 104,
    KEY_Shift_L: 105, KEY_Shift_R: 106, KEY_Super_L: 107, KEY_Super_R: 108,
    KEY_Return: 109, KEY_Escape: 110, EVENT_PROPAGATE: false, EVENT_STOP: true};
for (let i = 1; i <= 12; i++) Clutter[`KEY_F${i}`] = 200 + i;
const Runtime = new Function('Extension', 'Experiment', 'Main', 'Clutter', 'GLib',
    `${extensionSource}\nreturn TinyHandExtension;`)(class {}, Model, Main, Clutter,
    {get_monotonic_time: () => 10e6});

test('experiment is opt-in with bounded settings and independent copies', () => {
    const config = Model.normalizeExperiment({presentation: {radius: Infinity, dim: 9, enabled: 'yes'},
        ink: {width: -4, tool: 'bad'}, sound: {volume: 99}, custom: {tipX: -3},
        toolbar: {position: {x: 500, y: -20}}, future: {nested: true}});
    assert.equal(config.presentation.enabled, false);
    assert.equal(config.presentation.radius, 140);
    assert.equal(config.presentation.dim, 0.85);
    assert.equal(config.ink.width, 2);
    assert.equal(config.ink.tool, 'freehand');
    assert.equal(config.sound.volume, 1);
    assert.equal(config.custom.tipX, 0);
    assert.deepEqual(config.toolbar.position, {x: 1, y: 0});
    assert.deepEqual(config.future, {nested: true});
    config.presentation.enabled = true;
    assert.equal(Model.normalizeExperiment({}).presentation.enabled, false);
});

test('profiles snapshot only supported appearance and interaction sections', () => {
    const input = {enabled: false, pointer: {style: 'laser'}, toolbar: {position: {x: 1}},
        hotkeys: {clear: 'bad'}, profiles: [], appRules: [], future: true};
    const settings = Model.snapshotProfile(input);
    assert.deepEqual(settings, {pointer: {style: 'laser'}});
    settings.pointer.style = 'cookie';
    assert.equal(input.pointer.style, 'laser');
});

test('profile application cannot inject rules, enabled state or arbitrary config', () => {
    const input = {profiles: [{name: 'Teaching', settings: {enabled: false, appRules: ['bad'],
        sound: {volume: 0.5}, pointer: {style: 'laser'}}}]};
    assert.deepEqual(Model.profilePatch(input, 'Teaching'), {sound: {volume: 0.5}, pointer: {style: 'laser'}});
    assert.equal(Model.profilePatch(input, 'missing'), null);
});

test('per-app rules are exact case-insensitive ephemeral overrides', () => {
    const config = Model.normalizeExperiment({enabled: true, pointer: {style: 'lavender', size: 0.13},
        profiles: [{name: 'Teaching', settings: {pointer: {style: 'laser'}}}],
        appRules: [{appId: 'org.example.Game', action: 'hide'},
            {appId: 'org.example.Slides', action: 'profile', profile: 'Teaching'}]});
    assert.equal(Model.appOverride(config, 'ORG.EXAMPLE.GAME').enabled, false);
    assert.equal(Model.appOverride(config, 'org.example.Game2'), config);
    const profile = Model.appOverride(config, 'org.example.Slides');
    assert.equal(profile.pointer.style, 'laser');
    assert.equal(profile.pointer.size, 0.13);
    assert.equal(config.pointer.style, 'lavender');
    assert.equal(config.enabled, true);
    assert.equal(Model.appOverride(config, ''), config);
});

test('invalid and oversized rule/profile collections are bounded', () => {
    const config = Model.normalizeExperiment({profiles: [null, {}, ...Array(25).fill({name: 'A', settings: {}})],
        appRules: [{appId: '*', action: 'execute'}, ...Array(55).fill({appId: 'app', action: 'hide'})]});
    assert.equal(config.profiles.length, 20);
    assert.equal(config.appRules.length, 50);
});

test('normalization drops prototype pollution keys at every level', () => {
    const config = Model.normalizeExperiment(JSON.parse('{"__proto__":{"polluted":true},"ink":{"constructor":{"bad":1}}}'));
    assert.equal(Object.hasOwn(config, '__proto__'), false);
    assert.equal(Object.hasOwn(config.ink, 'constructor'), false);
    assert.equal({}.polluted, undefined);
});

test('saved toolbar coordinates stay within resized and negative-origin work areas', () => {
    for (const area of [{x: -1920, y: 24, width: 1920, height: 1000}, {x: 0, y: 0, width: 400, height: 300}]) {
        for (const x of [0, 0.5, 1]) for (const y of [0, 0.5, 1]) {
            const [left, top] = Model.toolbarPosition({toolbar: {position: {x, y}}}, area, 360, 60);
            assert.ok(left >= area.x && left + 360 <= area.x + area.width);
            assert.ok(top >= area.y && top + 60 <= area.y + area.height);
        }
    }
});

test('undo removes only last stroke and persistent ink bypasses fading', () => {
    const ext = new Runtime();
    ext._config = {ink: {fade: 1, permanent: true}};
    ext._strokes = [{points: [[0, 0]], start: 0}, {points: [[1, 1]], start: 0}];
    ext._active = ext._strokes[1];
    assert.equal(ext._alpha(ext._strokes[0], 1000), 1);
    ext._undo();
    assert.equal(ext._strokes.length, 1);
    assert.equal(ext._active, null);
    assert.equal(ext._dirty, true);
    ext._undo();
    assert.doesNotThrow(() => ext._undo());
});

test('keystroke display never records or converts printable text', () => {
    const ext = new Runtime();
    ext._config = Model.normalizeExperiment({enabled: true, presentation: {enabled: true, keystrokes: true}});
    const event = (symbol, state = 0) => ({type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => symbol, get_state: () => state});
    assert.equal(ext._captureEvent(event(97)), Clutter.EVENT_PROPAGATE);
    assert.equal(ext._shortcutText, '');
    ext._captureEvent(event(97, 4));
    assert.equal(ext._shortcutText, 'Ctrl');
    ext._captureEvent(event(Clutter.KEY_Return, 4));
    assert.equal(ext._shortcutText, 'Ctrl + Enter');
    ext._captureEvent(event(Clutter.KEY_Control_L));
    assert.equal(ext._shortcutText, 'Ctrl');
    assert.doesNotMatch(extensionSource, /keyval_to_unicode|get_key_unicode|String\.fromCharCode/);
});

test('key events are not inspected when feature is off or session is locked', () => {
    const ext = new Runtime();
    ext._config = Model.normalizeExperiment({enabled: true});
    const event = {type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol() { throw new Error('Must not inspect'); }};
    assert.equal(ext._captureEvent(event), Clutter.EVENT_PROPAGATE);
    ext._config.presentation.enabled = ext._config.presentation.keystrokes = true;
    Main.sessionMode.isLocked = true;
    try { assert.equal(ext._captureEvent(event), Clutter.EVENT_PROPAGATE); }
    finally { Main.sessionMode.isLocked = false; }
});

test('switching away from an app restores base configuration without writes', () => {
    const ext = new Runtime();
    ext._baseConfig = Model.normalizeExperiment({enabled: true, appRules: [{appId: 'game', action: 'hide'}]});
    ext._config = ext._baseConfig;
    ext._visibility = () => {};
    ext._update = () => { throw new Error('No persistence during focus change'); };
    ext._applyContext('game');
    assert.equal(ext._config.enabled, false);
    ext._applyContext('editor');
    assert.equal(ext._config.enabled, true);
    assert.equal(ext._config, ext._baseConfig);
});

test('dragging clamps positions and persists normalized coordinates only on release', () => {
    const ext = new Runtime();
    ext._config = Model.normalizeExperiment({});
    const area = {x: 0, y: 24, width: 1200, height: 800};
    let dismissed = 0, writes = 0, saved;
    ext._toolbarScale = 1;
    ext._toolbar = {width: 400, height: 60, x: 20, y: 40,
        set_position(x, y) { this.x = x; this.y = y; }};
    ext._inkTray = ext._hint = {hide() {}};
    ext._drag = {area, monitor: 0, dx: 10, dy: 10, grab: {dismiss() { dismissed++; }}};
    ext._update = patch => { writes++; saved = patch; };
    ext._captureEvent({type: () => Clutter.EventType.MOTION, get_coords: () => [9999, -200]});
    assert.equal(ext._toolbar.x, 800);
    assert.equal(ext._toolbar.y, 24);
    assert.equal(writes, 0);
    ext._captureEvent({type: () => Clutter.EventType.BUTTON_RELEASE, get_button: () => 1});
    assert.equal(writes, 1);
    assert.equal(dismissed, 1);
    assert.deepEqual(saved.toolbar.position, {x: 1, y: 0});
    assert.equal(ext._drag, null);
    ext._cancelDrag();
    assert.equal(dismissed, 1);
});

test('Escape cancels the drag grab without writing a new position', () => {
    const ext = new Runtime();
    let dismissed = 0;
    ext._drag = {grab: {dismiss() { dismissed++; }}};
    ext._positionToolbar = () => {};
    ext._update = () => { throw new Error('Must not save a cancelled drag'); };
    assert.equal(ext._captureEvent({type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Escape}), Clutter.EVENT_STOP);
    assert.equal(dismissed, 1);
    assert.equal(ext._ignoreUntilRelease, true);
});
