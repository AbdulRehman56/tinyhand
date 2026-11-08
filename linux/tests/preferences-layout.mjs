// Run with gjs -m linux/tests/preferences-layout.mjs on a graphical desktop.
// Always isolate settings before GTK or preferences resolve their config paths.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import System from 'system';
import {buildPreferences} from '../companion/tinyhand@abdulrehmankhan56/preferences.js';

const configDir = `/tmp/opencode/tinyhand-layout.${GLib.uuid_string_random()}`;
if (GLib.mkdir_with_parents(configDir, 0o700) !== 0)
    throw new Error('Cannot create isolated test settings directory');
GLib.setenv('XDG_CONFIG_HOME', configDir, true);
const app = new Adw.Application({application_id: 'io.github.AbdulRehman56.TinyHand.LayoutTest'});
let failed = false;
function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function descendants(root) {
    const result = [root];
    for (let child = root.get_first_child(); child; child = child.get_next_sibling())
        result.push(...descendants(child));
    return result;
}
const selectTile = (gallery, index) => descendants(gallery.get_child_at_index(index))
    .find(widget => widget instanceof Gtk.ToggleButton);
const pinButton = (gallery, index) => descendants(gallery.get_child_at_index(index))
    .find(widget => widget instanceof Gtk.Button && !(widget instanceof Gtk.ToggleButton));
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, search_enabled: false});
    const cleanup = buildPreferences(window);
    window.opacity = ARGV[0] ? 1 : 0;
    window.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
        let checkingPages = false;
        try {
            const widgets = descendants(window);
            const sidebar = widgets.find(widget => widget instanceof Gtk.StackSidebar);
            assert(sidebar && sidebar.get_height() >= 250, 'Sidebar is vertically clipped');
            const names = descendants(sidebar).filter(widget => widget instanceof Gtk.Label)
                .map(widget => widget.label);
            for (const name of ['General', 'Pointers', 'Appearance', 'Drawing', 'Sound'])
                assert(names.includes(name), `Missing sidebar section: ${name}`);
            for (const label of descendants(sidebar).filter(widget => widget instanceof Gtk.Label && names.includes(widget.label)))
                assert(label.get_height() >= 16, `Clipped navigation label: ${label.label}`);
            const gallery = widgets.find(widget => widget instanceof Gtk.FlowBox &&
                widget.get_child_at_index(36));
            assert(gallery, 'Missing 37-pointer gallery');
            const positions = [0, 1, 2].map(index => gallery.get_child_at_index(index).get_allocation().x);
            assert(new Set(positions).size === 3, 'Gallery does not fit three columns');
            const selected = descendants(gallery).find(widget => widget instanceof Gtk.ToggleButton && widget.active);
            assert(selected, 'Pointer selection has no active card');
            for (const child of descendants(selected).filter(widget => widget instanceof Gtk.Picture || widget instanceof Gtk.Label))
                assert(child.get_width() > 0 && child.get_height() > 0, 'Selected card content is not allocated');
            const stack = widgets.find(widget => widget instanceof Gtk.Stack && widget.get_child_by_name('pointers'));
            assert(stack, 'Missing settings section stack');
            for (const name of ['general', 'pointers', 'appearance', 'drawing', 'sound'])
                assert(stack.get_child_by_name(name), `Missing settings content: ${name}`);
            assert(GLib.get_user_config_dir() === configDir, 'Settings test is not isolated');
            {
                const configPath = `${GLib.get_user_config_dir()}/tinyhand/config.json`;
                const read = () => new TextDecoder().decode(GLib.file_get_contents(configPath)[1]);
                GLib.file_set_contents(configPath, JSON.stringify({custom: {keep: 42}, pointer: {style: 'lavender'},
                    toolbar: {custom: 'preserved'}}));
                selectTile(gallery, 1).emit('clicked');
                let saved = JSON.parse(read());
                assert(saved.pointer.style === 'glove' && saved.custom.keep === 42, 'Gallery did not preserve settings');
                const search = widgets.find(widget => widget instanceof Gtk.SearchEntry &&
                    widget.placeholder_text === 'Search pointers');
                assert(search, 'Missing pointer search');
                const visibleCards = () => Array.from({length: 37}, (_, index) => gallery.get_child_at_index(index))
                    .filter(child => child.visible);
                const beforeSearch = read();
                search.text = '  holographic  ';
                assert(visibleCards().length === 1 && gallery.get_child_at_index(11).visible,
                    `Search did not match display name or hide all nonmatches (${visibleCards().length} visible)`);
                search.text = 'holo';
                assert(visibleCards().length === 1, 'Search did not match style ID');
                search.text = 'no-pointer-matches';
                assert(visibleCards().length === 0, 'Unmatched search left cards visible');
                assert(selectTile(gallery, 1).active && read() === beforeSearch,
                    'Searching changed selection or wrote settings');
                search.text = '';
                assert(visibleCards().length === 37, 'Clearing search did not restore all pointers');
                const count = widgets.find(widget => widget instanceof Gtk.Label && widget.label.startsWith('Pinned '));
                assert(count?.label.startsWith('Pinned 6/6'), 'Default toolbar pins are missing');
                const pinPink = pinButton(gallery, 5);
                assert(pinPink.sensitive && pinPink.tooltip_text === 'Pin Pink to toolbar',
                    'Unpinned control is not actionable at the limit');
                pinPink.emit('clicked');
                assert(read() === beforeSearch, 'Seventh pin attempt wrote settings');
                assert(widgets.some(widget => widget instanceof Gtk.Label && widget.visible &&
                    widget.label.includes('Toolbar is full')), 'Pin limit has no visible feedback');
                const lavenderPin = pinButton(gallery, 0);
                assert(lavenderPin.tooltip_text === 'Unpin Lavender from toolbar', 'Pinned action label is unclear');
                lavenderPin.emit('clicked');
                saved = JSON.parse(read());
                assert(saved.toolbar.pinnedStyles.length === 5 && !saved.toolbar.pinnedStyles.includes('lavender'),
                    'Unpin did not save toolbar array');
                pinPink.emit('clicked');
                saved = JSON.parse(read());
                assert(saved.toolbar.pinnedStyles.length === 6 && saved.toolbar.pinnedStyles.at(-1) === 'pink',
                    'Pin did not save toolbar array');
                assert(saved.custom.keep === 42 && saved.toolbar.custom === 'preserved' &&
                    saved.pointer.style === 'glove' && selectTile(gallery, 1).active,
                    'Pinning changed selection or discarded unknown settings');
                assert(count.label.startsWith('Pinned 6/6'), 'Pin counter was not refreshed');

                // Fresh, unpresented windows exercise normalization without racing the file monitor.
                const defaultPins = ['lavender', 'glove', 'coral', 'plush', 'robot', 'laser'];
                for (const [toolbar, expected] of [
                    [undefined, defaultPins], [null, defaultPins], [{pinnedStyles: 'invalid'}, defaultPins],
                    [{pinnedStyles: []}, []],
                    [{pinnedStyles: ['pink', 'pink', 'invalid', null, 'glove']}, ['pink', 'glove']],
                    [{pinnedStyles: ['pink', 'glove', 'coral', 'plush', 'robot', 'laser', 'mint']},
                        ['pink', 'glove', 'coral', 'plush', 'robot', 'laser']],
                ]) {
                    GLib.file_set_contents(configPath, JSON.stringify({toolbar}));
                    const original = read();
                    const fixture = new Adw.PreferencesWindow({search_enabled: false});
                    const dispose = buildPreferences(fixture);
                    try {
                        assert(descendants(fixture).some(widget => widget instanceof Gtk.Label &&
                            widget.label.startsWith(`Pinned ${expected.length}/6`)), 'Toolbar normalization failed');
                        assert(read() === original, 'Normalization unexpectedly wrote settings');
                        const fixtureGallery = descendants(fixture).find(widget => widget instanceof Gtk.FlowBox &&
                            widget.get_child_at_index(36));
                        const first = expected[0] ?? 'lavender';
                        const index = Array.from({length: 37}, (_, i) => i).find(i =>
                            selectTile(fixtureGallery, i).tooltip_text.toLowerCase() === first);
                        pinButton(fixtureGallery, index).emit('clicked');
                        const updated = expected.length ? expected.filter(name => name !== first) : ['lavender'];
                        assert(JSON.stringify(JSON.parse(read()).toolbar.pinnedStyles) === JSON.stringify(updated),
                            'Pin action did not preserve normalized order, uniqueness, valid styles, or maximum');
                    } finally {
                        dispose();
                        fixture.close();
                    }
                }
                GLib.file_set_contents(configPath, JSON.stringify(saved));
                const mode = widgets.find(widget => widget instanceof Adw.ComboRow && widget.title === 'Pointer mode');
                mode.selected = 1;
                assert(JSON.parse(read()).interaction.mode === 'draw', 'Draw mode was not saved');
                const cursor = widgets.find(widget => widget instanceof Adw.SwitchRow && widget.title === 'Hide system cursor');
                cursor.active = false;
                assert(JSON.parse(read()).interaction.hideCursor === false, 'Cursor visibility was not saved');
                const valid = read();
                GLib.file_set_contents(configPath, '{');
                selectTile(gallery, 2).emit('clicked');
                assert(read() === '{', 'UI overwrote malformed JSON');
                pinPink.emit('clicked');
                assert(read() === '{', 'Pin action overwrote malformed JSON');
                GLib.file_set_contents(configPath, valid);
                search.text = 'laser';
                widgets.find(widget => widget instanceof Gtk.Button && widget.label === 'Reset Defaults').emit('clicked');
                assert(search.text === '' && visibleCards().length === 37, 'Reset did not clear gallery search');
                saved = JSON.parse(read());
                assert(JSON.stringify(saved.toolbar.pinnedStyles) ===
                    JSON.stringify(['lavender', 'glove', 'coral', 'plush', 'robot', 'laser']) &&
                    saved.custom.keep === 42 && saved.toolbar.custom === 'preserved', 'Reset lost defaults or unknown keys');
                print('PASS: search, pin/unpin, six-pin limit feedback, normalization, reset, interaction controls, unknown keys, malformed-file protection.');
            }
            if (ARGV[0]) {
                const workspace = stack.get_parent();
                const paintable = new Gtk.WidgetPaintable({widget: workspace});
                const snapshot = new Gtk.Snapshot();
                paintable.snapshot(snapshot, workspace.get_width(), workspace.get_height());
                const node = snapshot.to_node();
                assert(node, 'Cannot snapshot settings workspace');
                window.get_renderer().render_texture(node, null).save_to_png(ARGV[0]);
            }
            print(`PASS: five sidebar sections visible; sidebar ${sidebar.get_width()}x${sidebar.get_height()}; 37 pointers in at least three columns.`);
            const pageNames = ['general', 'appearance', 'drawing', 'sound'];
            let index = 0;
            stack.set_visible_child_name(pageNames[index]);
            checkingPages = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                try {
                    const page = stack.get_visible_child();
                    assert(page.get_width() >= 400 && page.get_height() >= 400,
                        `Settings section is cramped or unallocated: ${pageNames[index]}`);
                    print(`PASS: ${pageNames[index]} allocated ${page.get_width()}x${page.get_height()}.`);
                    index++;
                    if (index < pageNames.length) {
                        stack.set_visible_child_name(pageNames[index]);
                        return GLib.SOURCE_CONTINUE;
                    }
                } catch (error) {
                    failed = true;
                    printerr(error.stack);
                }
                cleanup();
                window.close();
                app.quit();
                return GLib.SOURCE_REMOVE;
            });
        } catch (error) {
            failed = true;
            printerr(`${error.message}\n${error.stack}`);
        } finally {
            if (!checkingPages) {
                cleanup();
                window.close();
                app.quit();
            }
        }
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
if (failed) System.exit(1);
