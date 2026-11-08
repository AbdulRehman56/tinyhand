import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULTS = {
    enabled: true,
    pointer: {style: 'lavender', size: 0.13, shadow: true},
    ink: {choice: 'match', fade: 3.0},
    sound: {hand: true, laser: false, tap: 'thock'},
    interaction: {mode: 'point', hideCursor: true},
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

/** Fill an Adw.PreferencesWindow; return an idempotent cleanup function.
 * @param {Adw.PreferencesWindow} window
 * @param {string|null} assetDir optional assets directory
 */
export function buildPreferences(window, assetDir = null) {
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
    rail.append(sidebar);
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
            config = merge(DEFAULTS, read().value);
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
            if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
                throw new Error('Cannot create the configuration directory');
            file.replace_contents(JSON.stringify(merge(value, patch), null, 2) + '\n',
                etag, false, Gio.FileCreateFlags.PRIVATE, null);
            refresh();
        } catch (error) {
            // Revert the unsaved control where possible without hiding the error.
            syncing = true;
            try { for (const update of bindings) update(config); }
            finally { syncing = false; }
            showError(`Could not save: ${error.message}. Existing configuration was not overwritten.`);
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
            subtitle_lines: 0});
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
    const selection = new Gtk.Label({xalign: 0, margin_bottom: 8});
    gallery.add(selection);
    const flow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE,
        min_children_per_line: 3, max_children_per_line: 4, row_spacing: 8, column_spacing: 8,
        homogeneous: true, valign: Gtk.Align.START});
    // One scroll surface per section: nesting another scroller clips the gallery
    // and makes wheel/keyboard navigation unpredictable.
    gallery.add(flow);
    const tiles = new Map();
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
        flow.insert(tile, -1);
        tiles.set(style, tile);
    }
    bindings.push(value => {
        const style = value.pointer?.style ?? DEFAULTS.pointer.style;
        selection.label = `Selected: ${STYLES.includes(style) ? title(style) : style}`;
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
            const process = Gio.Subprocess.new(['paplay', path], Gio.SubprocessFlags.STDERR_PIPE);
            process.communicate_utf8_async(null, null, (source, result) => {
                try {
                    const [, , stderr] = source.communicate_utf8_finish(result);
                    if (!closed && !source.get_successful()) showError(`Sound preview failed: ${stderr.trim()}`);
                } catch (error) {
                    if (!closed) showError(`Sound preview failed: ${error.message}`);
                }
            });
        } catch (error) { showError(`Sound preview failed: ${error.message}`); }
    }
    connect(test, 'clicked', () => playSound(TAPS[tap.selected] ?? 'thock'));

    const reset = group(generalPage, 'Defaults', 'Reset the settings shown here. Other configuration is preserved.');
    const resetRow = new Adw.ActionRow({title: 'Restore default appearance, ink and sound'});
    const resetButton = new Gtk.Button({label: 'Reset Defaults', valign: Gtk.Align.CENTER});
    resetRow.add_suffix(resetButton);
    resetRow.activatable_widget = resetButton;
    reset.add(resetRow);
    connect(resetButton, 'clicked', () => save(DEFAULTS));
    // Open on the visual picker: this is a customization window first.
    stack.visible_child_name = 'pointers';

    function cleanup() {
        if (closed) return;
        closed = true;
        if (reloadSource) GLib.source_remove(reloadSource);
        reloadSource = 0;
        monitor?.cancel();
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
