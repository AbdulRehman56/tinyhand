// Run from the repo root with a temporary XDG_CONFIG_HOME, on a graphical desktop.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import System from 'system';
import {buildPreferences} from '../companion/tinyhand@abdulrehmankhan56/preferences.js';

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
            // Only exercise writes when the caller explicitly isolates config.
            // Running this test against the real desktop remains read-only.
            const configDir = GLib.get_user_config_dir();
            if (configDir.startsWith(`${GLib.get_tmp_dir()}/`) &&
                GLib.path_get_basename(configDir).startsWith('tinyhand-layout.')) {
                const configPath = `${GLib.get_user_config_dir()}/tinyhand/config.json`;
                const read = () => new TextDecoder().decode(GLib.file_get_contents(configPath)[1]);
                GLib.file_set_contents(configPath, JSON.stringify({custom: {keep: 42}, pointer: {style: 'lavender'}}));
                gallery.get_child_at_index(1).get_child().emit('clicked');
                let saved = JSON.parse(read());
                assert(saved.pointer.style === 'glove' && saved.custom.keep === 42, 'Gallery did not preserve settings');
                const mode = widgets.find(widget => widget instanceof Adw.ComboRow && widget.title === 'Pointer mode');
                mode.selected = 1;
                assert(JSON.parse(read()).interaction.mode === 'draw', 'Draw mode was not saved');
                const cursor = widgets.find(widget => widget instanceof Adw.SwitchRow && widget.title === 'Hide system cursor');
                cursor.active = false;
                assert(JSON.parse(read()).interaction.hideCursor === false, 'Cursor visibility was not saved');
                const valid = read();
                GLib.file_set_contents(configPath, '{');
                gallery.get_child_at_index(2).get_child().emit('clicked');
                assert(read() === '{', 'UI overwrote malformed JSON');
                GLib.file_set_contents(configPath, valid);
                print('PASS: hand selection, interaction mode, cursor switch, unknown-key preservation, and malformed-file protection.');
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
            printerr(error.stack);
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
