import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {normalizeExperiment} from './experimental.js';

const DEFAULTS = {
    enabled: true,
    pointer: {style: 'lavender', size: 0.13, shadow: true},
    ink: {choice: 'match', fade: 3.0, tool: 'freehand', width: 6, permanent: false},
    sound: {hand: true, laser: false, tap: 'thock', volume: 1},
    interaction: {mode: 'point', hideCursor: true},
    toolbar: {pinnedStyles: ['lavender', 'glove', 'coral', 'plush', 'robot', 'laser'], collapsed: false, position: null, monitor: 0},
    presentation: {enabled: false, spotlight: false, radius: 140, dim: 0.45, ripples: true, keystrokes: false},
    accessibility: {reducedMotion: false, largeControls: false, highContrast: false},
    custom: {tipX: 0.5, tipY: 0.05},
    profiles: [], appRules: [],
};
const STYLES = [
    'lavender', 'glove', 'coral', 'plush', 'robot', 'pink', 'blue', 'mint',
    'lemon', 'black', 'chrome', 'holo', 'fuzzy', 'wood', 'marble', 'terrazzo',
    'glass', 'jelly', 'pastel', 'pixel', 'lowpoly', 'knit', 'skeleton', 'astro',
    'space', 'monster', 'water', 'lava', 'grass', 'cactus', 'choco', 'cloud',
    'mech', 'neon', 'leaf', 'cookie', 'laser',
];
const COLORS = ['match', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white', 'black'];
const TAPS = ['thock', 'click', 'pop', 'boop', 'squeak', 'wood'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pinnedStyles = value => Array.isArray(value)
    ? [...new Set(value.filter(style => STYLES.includes(style)))].slice(0, 6)
    : [...DEFAULTS.toolbar.pinnedStyles];
const title = value => ({lowpoly: 'Low Poly', choco: 'Chocolate', holo: 'Holographic',
    astro: 'Astronaut', mech: 'Mechanical', match: 'Match pointer'}[value] ??
    value.charAt(0).toUpperCase() + value.slice(1));

function merge(base, patch) {
    const result = Object.create(null);
    for (const source of [base, patch]) {
        if (!isObject(source)) continue;
        for (const [key, value] of Object.entries(source)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
            result[key] = isObject(value)
                ? merge(isObject(result[key]) ? result[key] : {}, value) : value;
        }
    }
    return result;
}

function findAssets(assetDir) {
    const bundled = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('assets').get_path();
    const candidates = assetDir ? [assetDir, bundled] : [bundled];
    candidates.push(GLib.build_filenamev([GLib.get_user_data_dir(), 'tinyhand', 'assets']));
    let dir = Gio.File.new_for_uri(import.meta.url).get_parent();
    while (dir) {
        candidates.push(dir.get_child('assets').get_path());
        dir = dir.get_parent();
    }
    return candidates.find(path => GLib.file_test(path, GLib.FileTest.IS_DIR)) ?? null;
}

// Measure only the upper hand, ending where the broad wrist narrows to the rod.
// Downsampling before scanning keeps all 36 previews cheap to construct.
function handTexture(path) {
    const image = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 256, 384, true);
    const pixels = image.get_pixels();
    const rows = [];
    for (let y = 0; y < image.height; y++) {
        let left = image.width, right = -1, count = 0;
        for (let x = 0; x < image.width; x++) {
            if (!image.has_alpha || pixels[y * image.rowstride + x * image.n_channels + image.n_channels - 1] > 96) {
                left = Math.min(left, x);
                right = x;
                count++;
            }
        }
        rows.push({left, right, count});
    }
    const top = rows.findIndex(row => row.count > 0);
    if (top < 0) throw new Error('Empty preview image');
    const maxWidth = Math.max(...rows.slice(top, Math.floor(image.height * 0.5)).map(row => row.count));
    const fist = rows.findIndex((row, y) => y >= top && row.count > maxWidth * 0.6);
    let bottom = rows.findIndex((row, y) => y > fist && row.count < maxWidth * 0.35);
    if (bottom <= top) bottom = Math.floor(image.height * 0.48);
    const hand = rows.slice(top, bottom);
    const left = Math.max(0, Math.min(...hand.filter(row => row.count).map(row => row.left)) - 3);
    const right = Math.min(image.width, Math.max(...hand.map(row => row.right)) + 4);
    const y = Math.max(0, top - 3);
    const crop = image.new_subpixbuf(left, y, right - left, Math.min(image.height, bottom + 2) - y);
    return Gdk.Texture.new_for_pixbuf(crop);
}

// Validate before decoding so oversized PNG headers cannot allocate huge buffers.
// Exported for isolated GTK/GdkPixbuf regression tests; no filesystem side effects.
export function normalizeCustomArtwork(bytes) {
    if (bytes.length > 8 * 1024 * 1024 || bytes.length < 24 ||
        ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
        throw new Error('The file is not a valid PNG (maximum 8 MiB)');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > 4096 || height > 4096)
        throw new Error('PNG dimensions must be between 1 and 4096 pixels');
    const loader = GdkPixbuf.PixbufLoader.new_with_type('png');
    try { loader.write(bytes); loader.close(); }
    catch (error) { try { loader.close(); } catch (_) {} throw error; }
    const image = loader.get_pixbuf();
    if (!image?.has_alpha) throw new Error('PNG must have an alpha channel');
    const pixels = image.get_pixels();
    let nonempty = false;
    for (let y = 0; y < image.height && !nonempty; y++)
        for (let x = 0; x < image.width; x++)
            if (pixels[y * image.rowstride + x * image.n_channels + image.n_channels - 1]) {
                nonempty = true; break;
            }
    if (!nonempty) throw new Error('PNG is entirely transparent');
    const ratio = Math.min(1, 384 / image.width, 576 / image.height);
    return ratio < 1 ? image.scale_simple(Math.max(1, Math.round(image.width * ratio)),
        Math.max(1, Math.round(image.height * ratio)), GdkPixbuf.InterpType.BILINEAR) : image;
}

/** Fill an Adw.PreferencesWindow; return an idempotent cleanup function.
 * @param {Adw.PreferencesWindow} window
 * @param {string|null} assetDir optional assets directory
 */
export function buildPreferences(window, assetDir = null, settings = null) {
    if (Gtk.check_version(4, 8, 0) || typeof Adw.SwitchRow !== 'function')
        throw new Error('TinyHand Settings requires GTK 4.8 or later and libadwaita 1.4 or later.');
    const assets = findAssets(assetDir);
    const directory = GLib.build_filenamev([GLib.get_user_config_dir(), 'tinyhand']);
    const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'config.json']));
    let syncing = false;
    let closed = false;
    let monitor = null;
    let reloadSource = 0;
    let config = merge(DEFAULTS, {});
    const previews = new Set();
    const confirmations = new Set();
    let chooser = null;
    const bindings = [];
    const errors = [];
    const signals = [];
    const connect = (object, name, callback) => {
        const id = object.connect(name, callback);
        signals.push([object, id]);
        return id;
    };
    window.set_title('TinyHand Settings');
    window.set_default_size(920, 680);
    // Keep the native preferences host, but mirror TinyHand's compact sidebar
    // and card-based settings rather than a long, tabbed GNOME form.
    const host = new Adw.PreferencesPage({title: 'TinyHand'});
    const workspaceGroup = new Adw.PreferencesGroup();
    const workspace = new Gtk.Box({spacing: 16, height_request: 510, width_request: 720,
        hexpand: true, vexpand: true});
    const stack = new Gtk.Stack({hexpand: true, vexpand: true,
        transition_type: Gtk.StackTransitionType.CROSSFADE});
    const sidebar = new Gtk.StackSidebar({stack, width_request: 155, valign: Gtk.Align.FILL,
        vexpand: true});
    sidebar.add_css_class('navigation-sidebar');
    const rail = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, vexpand: true});
    rail.append(new Gtk.ScrolledWindow({child: sidebar, vexpand: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC}));
    const brand = new Gtk.Label({label: 'TinyHand', xalign: 0, margin_start: 12,
        margin_bottom: 12, valign: Gtk.Align.END});
    brand.add_css_class('heading');
    rail.append(brand);
    workspace.append(rail);
    workspace.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL}));
    workspace.append(stack);
    workspaceGroup.add(workspace);
    host.add(workspaceGroup);
    window.add(host);

    function showError(message) {
        for (const row of errors) {
            row.subtitle = message ?? '';
            row.visible = Boolean(message);
        }
    }

    function read() {
        try {
            const [, bytes, etag] = file.load_contents(null);
            const value = JSON.parse(new TextDecoder().decode(bytes));
            if (!isObject(value)) throw new Error('The configuration must contain a JSON object.');
            return {value, etag};
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return {value: {}, etag: null};
            throw error;
        }
    }

    function refresh() {
        if (closed) return;
        try {
            config = normalizeExperiment(merge(DEFAULTS, read().value));
            config.toolbar = merge(isObject(config.toolbar) ? config.toolbar : {},
                {pinnedStyles: pinnedStyles(config.toolbar?.pinnedStyles)});
            syncing = true;
            for (const update of bindings) update(config);
            showError(null);
        } catch (error) {
            showError(`Cannot read config.json: ${error.message}. The file has not been changed.`);
        } finally {
            syncing = false;
        }
    }

    function save(patch) {
        if (syncing || closed) return;
        try {
            // Read on EVERY interaction, preserving unknown keys and other clients' edits.
            // An etag conflict refuses the write instead of overwriting a concurrent edit.
            const {value, etag} = read();
            const changes = typeof patch === 'function' ? patch(value) : patch;
            if (!changes) return false;
            if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
                throw new Error('Cannot create the configuration directory');
            file.replace_contents(JSON.stringify(merge(value, changes), null, 2) + '\n',
                etag, false, Gio.FileCreateFlags.PRIVATE, null);
            refresh();
            return true;
        } catch (error) {
            // Revert the unsaved control where possible without hiding the error.
            syncing = true;
            try { for (const update of bindings) update(config); }
            finally { syncing = false; }
            showError(`Could not save: ${error.message}. Existing configuration was not overwritten.`);
            return false;
        }
    }

    function page(name, icon) {
        const result = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 20,
            margin_end: 8, margin_bottom: 16});
        const heading = new Gtk.Label({label: name, xalign: 0, margin_top: 4});
        heading.add_css_class('title-1');
        result.append(heading);
        const scroller = new Gtk.ScrolledWindow({child: result, hexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC});
        const stackPage = stack.add_titled(scroller, name.toLowerCase(), name);
        stackPage.icon_name = icon;
        const status = new Adw.PreferencesGroup();
        const error = new Adw.ActionRow({title: 'Configuration needs attention', visible: false,
            subtitle_lines: 0, accessible_role: Gtk.AccessibleRole.ALERT});
        error.add_css_class('error');
        status.add(error);
        result.append(status);
        errors.push(error);
        return result;
    }
    function group(parent, name, description) {
        const result = new Adw.PreferencesGroup({title: name, description});
        parent.append(result);
        return result;
    }
    function switchRow(parent, name, subtitle, section, key, fallback) {
        const row = new Adw.SwitchRow({title: name, subtitle});
        parent.add(row);
        bindings.push(value => {
            const current = section ? value[section]?.[key] : value[key];
            row.active = typeof current === 'boolean' ? current : fallback;
        });
        connect(row, 'notify::active', () => save(section ? {[section]: {[key]: row.active}} : {[key]: row.active}));
        return row;
    }
    function combo(parent, name, subtitle, values, section, key, fallback, labels = null) {
        const row = new Adw.ComboRow({title: name, subtitle,
            model: Gtk.StringList.new(labels ?? values.map(title))});
        parent.add(row);
        bindings.push(value => {
            const index = values.indexOf(value[section]?.[key]);
            row.selected = index < 0 ? values.indexOf(fallback) : index;
        });
        connect(row, 'notify::selected', () => {
            if (values[row.selected]) save({[section]: {[key]: values[row.selected]}});
        });
        return row;
    }
    function slider(parent, name, subtitle, section, key, low, high, step, fallback, format) {
        const row = new Adw.ActionRow({title: name, subtitle});
        const scale = new Gtk.Scale({orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: new Gtk.Adjustment({lower: low, upper: high, step_increment: step,
                page_increment: step * 5}), draw_value: false, hexpand: true,
            width_request: 160, valign: Gtk.Align.CENTER});
        const label = new Gtk.Label({width_chars: 10, xalign: 1, valign: Gtk.Align.CENTER});
        scale.update_property([Gtk.AccessibleProperty.LABEL], [name]);
        const box = new Gtk.Box({spacing: 12, valign: Gtk.Align.CENTER});
        box.append(scale);
        box.append(label);
        row.add_suffix(box);
        parent.add(row);
        bindings.push(value => {
            const number = value[section]?.[key];
            const current = Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
            scale.set_value(current);
            label.label = format(current);
        });
        connect(scale, 'value-changed', () => {
            const value = Math.round(scale.get_value() / step) * step;
            label.label = format(value);
            save({[section]: {[key]: Number(value.toFixed(3))}});
        });
    }

    const generalPage = page('General', 'preferences-system-symbolic');
    const general = group(generalPage, 'TinyHand', 'A tiny companion for your cursor. Changes apply immediately.');
    switchRow(general, 'Turn the pointer on or off', 'Show the hand and its drawing overlay.', null, 'enabled', true);
    const interaction = group(generalPage, 'Clicking for real', 'Point normally, or draw without selecting text underneath.');
    combo(interaction, 'Pointer mode', 'Point: normal clicks, no ink. Draw: capture clicks and draw. Hold Alt to interact normally.',
        ['point', 'draw'], 'interaction', 'mode', 'point',
        ['Point', 'Draw']);
    switchRow(interaction, 'Hide system cursor', 'Show only TinyHand instead of two pointers.',
        'interaction', 'hideCursor', true);
    const pointersPage = page('Pointers', 'input-mouse-symbolic');
    const gallery = group(pointersPage, 'Choose a pointer', '36 hands and a laser dot. Click a card to use it.');
    const search = new Gtk.SearchEntry({placeholder_text: 'Search pointers', hexpand: true});
    search.update_property([Gtk.AccessibleProperty.LABEL], ['Search pointers by name or style']);
    gallery.add(search);
    const selection = new Gtk.Label({xalign: 0, margin_bottom: 8});
    gallery.add(selection);
    const pinnedCount = new Gtk.Label({xalign: 0, wrap: true});
    pinnedCount.add_css_class('dim-label');
    gallery.add(pinnedCount);
    const pinFeedback = new Gtk.Label({xalign: 0, wrap: true, visible: false,
        accessible_role: Gtk.AccessibleRole.STATUS});
    gallery.add(pinFeedback);
    const flow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE,
        min_children_per_line: 3, max_children_per_line: 4, row_spacing: 8, column_spacing: 8,
        homogeneous: true, valign: Gtk.Align.START});
    // One scroll surface per section: nesting another scroller clips the gallery
    // and makes wheel/keyboard navigation unpredictable.
    gallery.add(flow);
    const tiles = new Map();
    const pins = new Map();
    const searchNames = new Map();
    const emptySearch = new Gtk.Label({label: 'No pointers found. Try another name.', xalign: 0,
        visible: false, wrap: true, accessible_role: Gtk.AccessibleRole.STATUS});
    gallery.add(emptySearch);
    function filterPointers() {
        const query = search.text.trim().toLowerCase();
        let matches = 0;
        for (const [child, name] of searchNames) {
            child.visible = !query || name.includes(query);
            if (child.visible) matches++;
        }
        emptySearch.visible = matches === 0;
    }
    connect(search, 'changed', filterPointers);
    for (const style of STYLES) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
            margin_top: 8, margin_bottom: 8, margin_start: 4, margin_end: 4});
        let preview;
        try {
            if (style === 'laser') {
                // A native vector-like dot, not a hand image or emoji.
                preview = new Gtk.DrawingArea({height_request: 64, width_request: 60});
                preview.set_draw_func((_area, cr, width, height) => {
                    cr.setSourceRGBA(1, 0.12, 0.12, 0.16);
                    cr.arc(width / 2, height / 2, 19, 0, Math.PI * 2);
                    cr.fill();
                    cr.setSourceRGBA(0.95, 0.08, 0.08, 1);
                    cr.arc(width / 2, height / 2, 7, 0, Math.PI * 2);
                    cr.fill();
                });
            } else {
                if (!assets) throw new Error('Assets not found');
                preview = new Gtk.Picture({paintable: handTexture(GLib.build_filenamev([assets, `hand_${style}.png`])),
                    height_request: 64, width_request: 60, can_shrink: true,
                    content_fit: Gtk.ContentFit.CONTAIN});
            }
        } catch (_) {
            preview = new Gtk.Image({icon_name: 'image-missing-symbolic', pixel_size: 48, height_request: 64});
        }
        box.append(preview);
        box.append(new Gtk.Label({label: title(style), ellipsize: 3}));
        const tile = new Gtk.ToggleButton({child: box, tooltip_text: title(style)});
        tile.update_property([Gtk.AccessibleProperty.LABEL], [title(style)]);
        connect(tile, 'clicked', () => save({pointer: {style}}));
        const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
        card.append(tile);
        const pin = new Gtk.Button();
        card.append(pin);
        connect(pin, 'clicked', () => save(value => {
            const current = pinnedStyles(value.toolbar?.pinnedStyles);
            const isPinned = current.includes(style);
            if (!isPinned && current.length >= 6) {
                pinFeedback.label = 'Toolbar is full (6/6). Unpin a pointer before adding another.';
                pinFeedback.visible = true;
                return null;
            }
            pinFeedback.visible = false;
            return {toolbar: {pinnedStyles: isPinned
                ? current.filter(name => name !== style) : [...current, style]}};
        }));
        flow.insert(card, -1);
        searchNames.set(card.get_parent(), `${style} ${title(style)}`.toLowerCase());
        pins.set(style, pin);
        tiles.set(style, tile);
    }
    filterPointers();
    bindings.push(value => {
        const style = value.pointer?.style ?? DEFAULTS.pointer.style;
        selection.label = `Selected: ${STYLES.includes(style) ? title(style) : style}`;
        const pinned = value.toolbar.pinnedStyles;
        pinnedCount.label = `Pinned ${pinned.length}/6 · Pin pointers for quick access in the toolbar.`;
        for (const [name, pin] of pins) {
            const isPinned = pinned.includes(name);
            const label = `${isPinned ? 'Unpin' : 'Pin'} ${title(name)} ${isPinned ? 'from' : 'to'} toolbar`;
            pin.label = isPinned ? 'Unpin' : 'Pin to toolbar';
            pin.tooltip_text = label;
            pin.update_property([Gtk.AccessibleProperty.LABEL], [label]);
            if (isPinned) pin.add_css_class('accent');
            else pin.remove_css_class('accent');
        }
        for (const [name, tile] of tiles) {
            tile.active = name === style;
            if (tile.active) tile.add_css_class('suggested-action');
            else tile.remove_css_class('suggested-action');
        }
    });
    if (!assets) gallery.description = 'Assets were not found. Install the TinyHand assets to see hand previews.';

    const appearance = page('Appearance', 'applications-graphics-symbolic');
    const pointer = group(appearance, 'Pointer', 'Make your companion feel at home.');
    slider(pointer, 'Size', 'Relative to the screen height.', 'pointer', 'size', 0.08, 0.20, 0.01, 0.13,
        value => `${Math.round(value * 100)}%`);
    switchRow(pointer, 'Shadow under the pointer', 'Add depth beneath the hand.', 'pointer', 'shadow', true);

    const drawing = page('Drawing', 'document-edit-symbolic');
    const ink = group(drawing, 'Ink', 'Customize the marks your pointer leaves behind.');
    combo(ink, 'Ink colour', 'Matches each pointer, or uses your chosen colour.', COLORS, 'ink', 'choice', 'match');
    slider(ink, 'Lines fade', 'Set to 0 to keep until cleared.', 'ink', 'fade', 0, 30, 1, 3,
        value => value === 0 ? 'Permanent' : `${Math.round(value)} s`);
    combo(ink, 'Drawing tool', 'Choose how strokes are drawn.', ['freehand', 'line', 'arrow'], 'ink', 'tool', 'freehand');
    slider(ink, 'Stroke width', 'Width in logical pixels.', 'ink', 'width', 2, 32, 1, 6, value => `${value} px`);
    switchRow(ink, 'Keep ink until cleared', 'Ignore the fade timer for new strokes.', 'ink', 'permanent', false);

    const soundPage = page('Sound', 'audio-speakers-symbolic');
    const soundCards = group(soundPage, 'Tap sound', 'Click a sound to hear it. It plays each time the hand taps.');
    const soundFlow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE,
        min_children_per_line: 2, max_children_per_line: 3, row_spacing: 8, column_spacing: 8,
        homogeneous: true});
    soundCards.add(soundFlow);
    const soundTiles = new Map();
    for (const choice of ['off', ...TAPS]) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8,
            margin_top: 12, margin_bottom: 12, margin_start: 8, margin_end: 8});
        box.append(new Gtk.Image({icon_name: choice === 'off' ? 'audio-volume-muted-symbolic' : 'audio-x-generic-symbolic', pixel_size: 22}));
        box.append(new Gtk.Label({label: title(choice)}));
        const tile = new Gtk.ToggleButton({child: box, tooltip_text: title(choice)});
        tile.update_property([Gtk.AccessibleProperty.LABEL], [choice === 'off' ? 'Tap sound off' : `Preview ${title(choice)}`]);
        connect(tile, 'clicked', () => {
            if (choice === 'off') save({sound: {hand: false}});
            else {
                save({sound: {hand: true, tap: choice}});
                playSound(choice);
            }
        });
        soundFlow.insert(tile, -1);
        soundTiles.set(choice, tile);
    }
    bindings.push(value => {
        const selected = value.sound?.hand === false ? 'off' : value.sound?.tap ?? 'thock';
        for (const [choice, tile] of soundTiles) {
            tile.active = choice === selected;
            if (tile.active) tile.add_css_class('suggested-action');
            else tile.remove_css_class('suggested-action');
        }
    });
    const sounds = group(soundPage, 'Options', 'Choose when TinyHand plays a sound.');
    switchRow(sounds, 'Hand sounds', 'Play a tap when using a hand pointer.', 'sound', 'hand', true);
    switchRow(sounds, 'Laser dot taps too', 'Off by default, for quiet pointing.', 'sound', 'laser', false);
    slider(sounds, 'Volume', 'Applies to tap feedback and previews.', 'sound', 'volume', 0, 1, 0.05, 1,
        value => `${Math.round(value * 100)}%`);
    const tap = combo(sounds, 'Tap sound', 'Preview any sound before choosing.', TAPS, 'sound', 'tap', 'thock');
    const testRow = new Adw.ActionRow({title: 'Preview sound', subtitle: 'Plays even when tap feedback is disabled.'});
    const test = new Gtk.Button({label: 'Test Sound', valign: Gtk.Align.CENTER});
    testRow.add_suffix(test);
    testRow.activatable_widget = test;
    sounds.add(testRow);
    function playSound(choice) {
        try {
            if (!assets) throw new Error('Sound assets were not found');
            const path = GLib.build_filenamev([assets, 'sounds', `tap_${choice}.wav`]);
            for (const pending of previews) pending.force_exit();
            previews.clear();
            const volume = Math.round(Math.max(0, Math.min(1, config.sound?.volume ?? 1)) * 65536);
            const process = Gio.Subprocess.new(['paplay', `--volume=${volume}`, path], Gio.SubprocessFlags.STDERR_PIPE);
            previews.add(process);
            process.communicate_utf8_async(null, null, (source, result) => {
                try {
                    const [, , stderr] = source.communicate_utf8_finish(result);
                    if (!closed && previews.has(source) && !source.get_successful()) showError(`Sound preview failed: ${stderr.trim()}`);
                } catch (error) {
                    if (!closed && previews.has(source)) showError(`Sound preview failed: ${error.message}`);
                } finally { previews.delete(source); }
            });
        } catch (error) { showError(`Sound preview failed: ${error.message}`); }
    }
    connect(test, 'clicked', () => playSound(TAPS[tap.selected] ?? 'thock'));

    function action(parent, name, label, callback, subtitle = '') {
        const row = new Adw.ActionRow({title: name, subtitle});
        const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
        row.add_suffix(button);
        row.activatable_widget = button;
        parent.add(row);
        connect(button, 'clicked', callback);
        return button;
    }
    function notice(parent) {
        const label = new Gtk.Label({xalign: 0, wrap: true, visible: false,
            accessible_role: Gtk.AccessibleRole.STATUS});
        parent.add(label);
        return message => { label.label = message; label.visible = true; };
    }
    function confirm(heading, body, callback) {
        const dialog = new Adw.MessageDialog({transient_for: window, modal: true, heading, body});
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('confirm', 'Confirm');
        dialog.set_response_appearance('confirm', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        confirmations.add(dialog);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'confirm' && !closed) callback();
            dialog.set_transient_for(null);
            confirmations.delete(dialog);
            dialog.destroy();
        });
        dialog.present();
    }

    const customGroup = group(pointersPage, 'Custom artwork',
        'Import a transparent PNG. It is displayed as a standalone image, not a hand on a stick. Preview first, then use it.');
    const customPreview = new Gtk.Picture({height_request: 160, can_shrink: true,
        content_fit: Gtk.ContentFit.CONTAIN});
    customGroup.add(customPreview);
    const customFeedback = notice(customGroup);
    const customPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'tinyhand', 'custom', 'hand.png']);
    let pendingArtwork = null;
    let displayedRevision = null;
    const useCustom = action(customGroup, 'Select previewed artwork', 'Use Custom', () => {
        try {
            if (pendingArtwork) {
                // Refuse malformed/unreadable configuration before touching an
                // existing custom slot. save() still checks a fresh etag later.
                read();
                const parent = Gio.File.new_for_path(customPath).get_parent();
                if (GLib.mkdir_with_parents(parent.get_path(), 0o700) !== 0)
                    throw new Error('Cannot create the private artwork directory');
                // Encode in memory, then atomically replace only our managed file.
                const [ok, bytes] = pendingArtwork.save_to_bufferv('png', [], []);
                if (!ok) throw new Error('Could not encode the artwork');
                Gio.File.new_for_path(customPath).replace_contents(bytes, null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                pendingArtwork = null;
                if (!save({pointer: {style: 'custom'}, custom: {revision: GLib.uuid_string_random()}})) {
                    customFeedback('Artwork imported, but configuration could not be saved. Fix the configuration error, then choose Use Custom again.');
                    return;
                }
            } else if (GLib.file_test(customPath, GLib.FileTest.IS_REGULAR)) {
                if (!save({pointer: {style: 'custom'}, custom: {revision: GLib.uuid_string_random()}})) return;
            } else throw new Error('Import and preview a PNG first');
            customFeedback('Artwork stored in TinyHand’s private data folder. Original files are unchanged.');
        } catch (error) { customFeedback(`Cannot use artwork: ${error.message}`); }
    });
    action(customGroup, 'Choose a transparent PNG', 'Import PNG…', () => {
        chooser?.destroy();
        chooser = new Gtk.FileChooserNative({title: 'Preview custom pointer', transient_for: window,
            action: Gtk.FileChooserAction.OPEN, accept_label: 'Preview', cancel_label: 'Cancel', modal: true});
        const filter = new Gtk.FileFilter({name: 'PNG images'});
        filter.add_mime_type('image/png');
        chooser.add_filter(filter);
        chooser.connect('response', (dialog, response) => {
            try {
                if (response !== Gtk.ResponseType.ACCEPT || closed) return;
                const selected = dialog.get_file();
                if (!selected?.get_path()) throw new Error('Choose a local PNG file');
                const info = selected.query_info('standard::size,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > 8 * 1024 * 1024)
                    throw new Error('Choose a regular PNG no larger than 8 MiB');
                const [, bytes] = selected.load_contents(null);
                pendingArtwork = normalizeCustomArtwork(bytes);
                customPreview.paintable = Gdk.Texture.new_for_pixbuf(pendingArtwork);
                useCustom.sensitive = true;
                customFeedback(`Preview: ${pendingArtwork.width} × ${pendingArtwork.height}. Choose Use Custom to save and select it.`);
            } catch (error) { customFeedback(`Cannot import PNG: ${error.message}`); }
            finally { dialog.destroy(); if (chooser === dialog) chooser = null; }
        });
        chooser.show();
    }, 'Maximum 8 MiB and 4096 × 4096 pixels. Normalized to fit 384 × 576.');
    slider(customGroup, 'Horizontal anchor', '0 = left edge; 1 = right edge.', 'custom', 'tipX', 0, 1, 0.01, 0.5,
        value => `${Math.round(value * 100)}%`);
    slider(customGroup, 'Vertical anchor', '0 = top edge; 1 = bottom edge. This point follows the cursor.', 'custom', 'tipY', 0, 1, 0.01, 0.05,
        value => `${Math.round(value * 100)}%`);
    bindings.push(value => {
        const exists = GLib.file_test(customPath, GLib.FileTest.IS_REGULAR);
        useCustom.sensitive = Boolean(pendingArtwork || exists);
        if (!pendingArtwork && exists && displayedRevision !== value.custom?.revision) {
            try {
                customPreview.paintable = Gdk.Texture.new_from_filename(customPath);
                displayedRevision = value.custom?.revision;
            } catch (error) { customFeedback(`Cannot preview saved artwork: ${error.message}`); }
        }
    });

    const toolkit = page('Toolkit', 'applications-utilities-symbolic');
    const presenting = group(toolkit, 'Presentation', 'Spotlight, click feedback and optional keystroke display.');
    switchRow(presenting, 'Presentation mode', 'Enable presentation effects.', 'presentation', 'enabled', false);
    switchRow(presenting, 'Spotlight', 'Dim the screen outside the cursor spotlight.', 'presentation', 'spotlight', false);
    slider(presenting, 'Spotlight radius', 'Radius in logical pixels.', 'presentation', 'radius', 40, 500, 10, 140, value => `${value} px`);
    slider(presenting, 'Background dimming', 'Opacity outside the spotlight.', 'presentation', 'dim', 0.1, 0.85, 0.05, 0.45,
        value => `${Math.round(value * 100)}%`);
    switchRow(presenting, 'Click ripples', 'Highlight pointer clicks.', 'presentation', 'ripples', true);
    switchRow(presenting, 'Show keystrokes', 'Best-effort modifiers, navigation and F1–F12 only; delivery depends on GNOME focus. Printable text is never shown or logged.', 'presentation', 'keystrokes', false);
    const toolbar = group(toolkit, 'Floating toolbar', 'Keyboard-adjustable position within the selected monitor.');
    switchRow(toolbar, 'Collapsed toolbar', 'Show the compact toolbar.', 'toolbar', 'collapsed', false);
    slider(toolbar, 'Monitor', '0 is the first monitor; unavailable monitors fall back automatically.', 'toolbar', 'monitor', 0, 15, 1, 0,
        value => `${value}`);
    for (const [axis, name] of [['x', 'Horizontal position'], ['y', 'Vertical position']]) {
        const row = new Adw.ActionRow({title: name, subtitle: '0% = start edge; 100% = end edge.'});
        const scale = new Gtk.Scale({orientation: Gtk.Orientation.HORIZONTAL, width_request: 200,
            valign: Gtk.Align.CENTER, digits: 0, draw_value: true,
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1, page_increment: 10})});
        scale.update_property([Gtk.AccessibleProperty.LABEL], [name]);
        row.add_suffix(scale);
        toolbar.add(row);
        bindings.push(value => scale.set_value((value.toolbar?.position?.[axis] ?? (axis === 'x' ? 0.5 : 1)) * 100));
        connect(scale, 'value-changed', () => save(value => ({toolbar: {position: {
            x: value.toolbar?.position?.x ?? 0.5, y: value.toolbar?.position?.y ?? 1,
            [axis]: scale.get_value() / 100}}})));
    }
    action(toolbar, 'Restore automatic toolbar position', 'Reset Position', () => save({toolbar: {position: null}}));
    const accessibility = group(toolkit, 'Accessibility', 'Adjust overlay motion, contrast and target sizes.');
    switchRow(accessibility, 'Reduced motion', 'Reduce animated overlay effects.', 'accessibility', 'reducedMotion', false);
    switchRow(accessibility, 'Large controls', 'Use larger toolbar targets.', 'accessibility', 'largeControls', false);
    switchRow(accessibility, 'High contrast', 'Increase overlay and toolbar contrast.', 'accessibility', 'highContrast', false);
    bindings.push(value => stack.transition_type = value.accessibility?.reducedMotion
        ? Gtk.StackTransitionType.NONE : Gtk.StackTransitionType.CROSSFADE);

    const shortcuts = group(toolkit, 'Keyboard shortcuts', 'Use GTK notation, for example &lt;Control&gt;&lt;Alt&gt;h. Empty disables a shortcut. Save validates all fields.');
    const shortcutFeedback = notice(shortcuts);
    if (!settings) {
        try {
            const schemaDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('schemas').get_path();
            const source = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup('org.gnome.shell.extensions.tinyhand', true);
            if (schema) settings = new Gio.Settings({settings_schema: schema});
        } catch (_) { /* Standalone packages may not ship compiled schemas. */ }
    }
    const shortcutRows = new Map();
    for (const [key, name] of [['toggle', 'Toggle TinyHand'], ['clear', 'Clear ink'], ['cycle', 'Cycle pointer'],
        ['mode', 'Switch pointer mode'], ['undo', 'Undo stroke'], ['presentation', 'Toggle presentation']]) {
        const available = settings?.settings_schema.has_key(key) && settings.settings_schema.get_key(key).get_value_type().dup_string() === 's';
        const row = new Adw.EntryRow({title: name, sensitive: Boolean(available)});
        row.text = available ? settings.get_string(key) : 'Unavailable — updated shortcut schema required';
        shortcuts.add(row);
        if (available) shortcutRows.set(key, row);
    }
    const saveShortcuts = action(shortcuts, 'Apply keyboard shortcuts', 'Save Shortcuts', () => {
        try {
            const seen = new Set(), changes = [];
            for (const [key, row] of shortcutRows) {
                const text = row.text.trim();
                let accelerator = '';
                if (text) {
                    const [ok, keyval, modifiers] = Gtk.accelerator_parse(text);
                    if (!ok || !Gtk.accelerator_valid(keyval, modifiers) ||
                        (!modifiers && /[\p{L}\p{N}]/u.test(String.fromCodePoint(Gdk.keyval_to_unicode(keyval) || 0))))
                        throw new Error(`${row.title}: use a valid shortcut with modifiers, not a plain letter or number.`);
                    accelerator = Gtk.accelerator_name(keyval, modifiers);
                    if (seen.has(accelerator)) throw new Error(`${row.title}: this shortcut is already used.`);
                    seen.add(accelerator);
                }
                if (!settings.is_writable(key)) throw new Error(`${row.title} is not writable.`);
                changes.push([key, accelerator]);
            }
            settings.delay();
            for (const [key, accelerator] of changes) settings.set_string(key, accelerator);
            settings.apply();
            shortcutFeedback('Shortcuts saved. Empty fields are disabled.');
        } catch (error) { settings?.revert(); shortcutFeedback(`Shortcuts unchanged: ${error.message}`); }
    });
    saveShortcuts.sensitive = shortcutRows.size > 0;
    if (shortcutRows.size < 6) shortcutFeedback('Some shortcuts are unavailable. Update or compile the extension schema to enable them.');

    const profilesPage = page('Profiles', 'document-properties-symbolic');
    const profiles = group(profilesPage, 'Named profiles', 'Save pointer, ink, sound, interaction, presentation and accessibility settings. Up to 20 profiles.');
    const profileFeedback = notice(profiles);
    const profileName = new Adw.EntryRow({title: 'New profile name'});
    profiles.add(profileName);
    const profileSections = ['pointer', 'ink', 'sound', 'interaction', 'presentation', 'accessibility'];
    const supportedSnapshot = value => {
        const result = {};
        const complete = merge(DEFAULTS, value);
        for (const section of profileSections) {
            result[section] = {};
            for (const key of Object.keys(DEFAULTS[section])) result[section][key] = complete[section]?.[key] ?? DEFAULTS[section][key];
        }
        return result;
    };
    const validProfiles = value => Array.isArray(value.profiles)
        ? value.profiles.filter(profile => typeof profile?.name === 'string' && isObject(profile.settings)).slice(0, 20) : [];
    action(profiles, 'Capture current settings', 'Save Profile', () => {
        const name = profileName.text.trim();
        if (!name || name.length > 60 || /[\x00-\x1f]/.test(name)) {
            profileFeedback('Enter a profile name from 1 to 60 characters, without control characters.'); return;
        }
        save(value => {
            const current = validProfiles(value);
            if (current.some(profile => profile.name.toLowerCase() === name.toLowerCase())) {
                profileFeedback('That profile name already exists. Choose another name.'); return null;
            }
            if (current.length >= 20) { profileFeedback('Profile limit reached (20). Delete a profile first.'); return null; }
            profileFeedback(`Saved profile “${name}”.`);
            return {profiles: [...current, {name, settings: supportedSnapshot(value)}]};
        });
    });
    const profileSelect = new Adw.ComboRow({title: 'Saved profile', model: Gtk.StringList.new(['No profiles'])});
    profiles.add(profileSelect);
    const selectedProfile = () => validProfiles(config)[profileSelect.selected];
    const applyProfile = action(profiles, 'Load selected settings', 'Apply Profile', () => {
        const profile = selectedProfile();
        if (!profile) return profileFeedback('Select a saved profile first.');
        const snapshot = supportedSnapshot(profile.settings);
        if (save(snapshot)) profileFeedback(`Applied profile “${profile.name}”. Toolbar and app rules were preserved.`);
    });
    const deleteProfile = action(profiles, 'Remove selected profile', 'Delete Profile', () => {
        const profile = selectedProfile();
        if (!profile) return profileFeedback('Select a saved profile first.');
        confirm('Delete profile?', `Delete “${profile.name}”? Rules using this profile will also be removed.`, () => save(value => ({
            profiles: validProfiles(value).filter(item => item.name !== profile.name),
            appRules: (Array.isArray(value.appRules) ? value.appRules : []).filter(rule => rule.profile !== profile.name),
        })));
    });
    const rules = group(profilesPage, 'Per-application rules', 'Exact, case-insensitive app IDs only (for example org.gnome.Terminal). Wildcards are not supported.');
    const ruleFeedback = notice(rules);
    const appId = new Adw.EntryRow({title: 'Exact application ID'});
    rules.add(appId);
    const ruleAction = new Adw.ComboRow({title: 'Application action', model: Gtk.StringList.new(['Hide TinyHand', 'Apply profile'])});
    rules.add(ruleAction);
    const ruleProfile = new Adw.ComboRow({title: 'Application profile', model: Gtk.StringList.new(['No profiles'])});
    rules.add(ruleProfile);
    connect(ruleAction, 'notify::selected', () => ruleProfile.sensitive = ruleAction.selected === 1 && validProfiles(config).length > 0);
    action(rules, 'Create application rule', 'Add Rule', () => {
        const id = appId.text.trim();
        if (!id || id.length > 200 || /[\s*?\[\]\x00-\x1f]/.test(id)) {
            ruleFeedback('Enter an exact application ID, without whitespace or wildcard characters.'); return;
        }
        const profile = validProfiles(config)[ruleProfile.selected];
        if (ruleAction.selected === 1 && !profile) { ruleFeedback('Save and select a profile first.'); return; }
        save(value => {
            const current = Array.isArray(value.appRules) ? value.appRules : [];
            if (current.length >= 50) { ruleFeedback('Rule limit reached (50). Delete a rule first.'); return null; }
            if (current.some(rule => String(rule.appId).toLowerCase() === id.toLowerCase())) {
                ruleFeedback('A rule for this application already exists. Delete it before adding a replacement.'); return null;
            }
            ruleFeedback(`Added rule for ${id}.`);
            return {appRules: [...current, {appId: id, action: ruleAction.selected === 1 ? 'profile' : 'hide', profile: profile?.name ?? ''}]};
        });
    });
    const ruleList = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
    rules.add(ruleList);
    let profileSignature = null, ruleSignature = null;
    bindings.push(value => {
        const current = validProfiles(value);
        const names = current.map(profile => profile.name);
        const signature = JSON.stringify(names);
        if (signature !== profileSignature) {
            profileSelect.model = Gtk.StringList.new(names.length ? names : ['No profiles']);
            ruleProfile.model = Gtk.StringList.new(names.length ? names : ['No profiles']);
            profileSignature = signature;
        }
        applyProfile.sensitive = deleteProfile.sensitive = current.length > 0;
        ruleProfile.sensitive = ruleAction.selected === 1 && current.length > 0;
        const currentRules = Array.isArray(value.appRules) ? value.appRules : [];
        const nextRules = JSON.stringify(currentRules);
        if (ruleSignature === nextRules) return;
        ruleSignature = nextRules;
        while (ruleList.get_first_child()) ruleList.remove(ruleList.get_first_child());
        for (const [index, rule] of currentRules.entries()) {
            const row = new Adw.ActionRow({title: String(rule.appId ?? 'Invalid application ID'),
                subtitle: rule.action === 'profile' ? `Profile: ${rule.profile}` : 'Hide TinyHand'});
            const remove = new Gtk.Button({label: 'Delete Rule', valign: Gtk.Align.CENTER,
                tooltip_text: `Delete rule for ${rule.appId}`});
            row.add_suffix(remove);
            // Dynamic rows own their signal; do not retain removed widgets in the cleanup list.
            remove.connect('clicked', () => confirm('Delete application rule?', `Remove the rule for ${rule.appId}?`,
                () => save(latest => ({appRules: (Array.isArray(latest.appRules) ? latest.appRules : [])
                    .filter((item, i) => i !== index || JSON.stringify(item) !== JSON.stringify(rule))}))));
            ruleList.append(row);
        }
    });

    const reset = group(generalPage, 'Defaults', 'Reset the settings shown here. Other configuration is preserved.');
    const resetRow = new Adw.ActionRow({title: 'Restore default appearance, ink and sound'});
    const resetButton = new Gtk.Button({label: 'Reset Defaults', valign: Gtk.Align.CENTER});
    resetRow.add_suffix(resetButton);
    resetRow.activatable_widget = resetButton;
    reset.add(resetRow);
    connect(resetButton, 'clicked', () => {
        search.text = '';
        pinFeedback.visible = false;
        const {profiles: _profiles, appRules: _rules, custom: _custom, ...defaults} = DEFAULTS;
        save(defaults);
    });
    // Open on the visual picker: this is a customization window first.
    stack.visible_child_name = 'pointers';

    function cleanup() {
        if (closed) return;
        closed = true;
        if (reloadSource) GLib.source_remove(reloadSource);
        reloadSource = 0;
        monitor?.cancel();
        chooser?.destroy();
        chooser = null;
        for (const dialog of confirmations) {
            dialog.set_transient_for(null);
            dialog.destroy();
        }
        confirmations.clear();
        for (const pending of previews) pending.force_exit();
        previews.clear();
        for (const [object, id] of signals) object.disconnect(id);
        signals.length = 0;
    }
    connect(window, 'close-request', () => { cleanup(); return false; });
    connect(window, 'unrealize', cleanup);
    refresh();
    try {
        if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
            throw new Error('Cannot create the configuration directory');
        // Watch the parent: atomic replacements from other clients remain observable.
        monitor = Gio.File.new_for_path(directory).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        connect(monitor, 'changed', (_monitor, changed, other) => {
            if (![changed?.get_basename(), other?.get_basename()].includes('config.json')) return;
            if (reloadSource) GLib.source_remove(reloadSource);
            reloadSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                reloadSource = 0;
                refresh();
                return GLib.SOURCE_REMOVE;
            });
        });
    } catch (error) { showError(`External changes cannot be monitored: ${error.message}`); }
    return cleanup;
}
