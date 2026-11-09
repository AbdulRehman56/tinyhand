// gjs -m linux/tests/preferences-experiment.mjs (requires a graphical GTK session).
// All writes, including the GSettings schema and artwork, are isolated.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';
const {buildPreferences, normalizeCustomArtwork} = ARGV[0]
    ? await import(Gio.File.new_for_path(`${ARGV[0]}/preferences.js`).get_uri())
    : await import('../companion/tinyhand@abdulrehmankhan56/preferences.js');

const root = `/tmp/opencode/tinyhand-experiment.${GLib.uuid_string_random()}`;
GLib.mkdir_with_parents(`${root}/tinyhand`, 0o700);
GLib.mkdir_with_parents(`${root}/data/tinyhand/custom`, 0o700);
GLib.setenv('XDG_CONFIG_HOME', root, true);
GLib.setenv('XDG_DATA_HOME', `${root}/data`, true);
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
const keys = ['toggle', 'clear', 'cycle', 'mode', 'undo', 'presentation'];
GLib.file_set_contents(`${root}/test.gschema.xml`, `<schemalist><schema id="io.tinyhand.test" path="/io/tinyhand/test/">${
    keys.map(key => `<key name="${key}" type="s"><default>''</default></key>`).join('')}</schema></schemalist>`);
const compiler = Gio.Subprocess.new(['glib-compile-schemas', root], Gio.SubprocessFlags.NONE);
compiler.wait_check(null);
const schema = Gio.SettingsSchemaSource.new_from_directory(root, Gio.SettingsSchemaSource.get_default(), false)
    .lookup('io.tinyhand.test', false);
const settings = new Gio.Settings({settings_schema: schema});
const configPath = `${root}/tinyhand/config.json`;
GLib.file_set_contents(configPath, JSON.stringify({unknown: {keep: 42}, toolbar: {pinnedStyles: ['pink'], extra: true},
    custom: {keep: true}, pointer: {size: 0.14}}));
const read = () => JSON.parse(new TextDecoder().decode(GLib.file_get_contents(configPath)[1]));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const descendants = root => {
    const result = [root];
    for (let child = root.get_first_child(); child; child = child.get_next_sibling()) result.push(...descendants(child));
    return result;
};
const rejects = (callback, message) => {
    let rejected = false;
    try { callback(); } catch (_) { rejected = true; }
    assert(rejected, message);
};
const png = (alpha, color, width = 8, height = 12) => {
    const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, alpha, 8, width, height);
    image.fill(color);
    const [ok, bytes] = image.save_to_bufferv('png', [], []);
    assert(ok, 'Cannot encode fixture PNG');
    return bytes;
};
let failed = false;
const app = new Adw.Application({application_id: 'io.github.AbdulRehman56.TinyHand.ExperimentTest'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, search_enabled: false, opacity: 0});
    const cleanup = buildPreferences(window, null, settings);
    window.present();
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
            assert(GLib.get_user_config_dir() === root && GLib.get_user_data_dir() === `${root}/data`, 'XDG isolation failed');
            const widgets = descendants(window);
            const row = name => widgets.find(widget => widget instanceof Adw.PreferencesRow && widget.title === name);
            const button = name => widgets.find(widget => widget instanceof Gtk.Button && widget.label === name);
            const click = name => { assert(button(name), `Missing button ${name}`); button(name).emit('clicked'); };
            const toggle = name => { assert(row(name), `Missing switch ${name}`); row(name).active = !row(name).active; };
            toggle('Presentation mode'); toggle('Spotlight'); toggle('Show keystrokes');
            toggle('Reduced motion'); toggle('Large controls'); toggle('High contrast');
            toggle('Collapsed toolbar'); toggle('Keep ink until cleared');
            row('Drawing tool').selected = 2;
            assert(read().presentation.enabled && read().presentation.spotlight && read().presentation.keystrokes, 'Presentation switches did not save');
            assert(read().accessibility.reducedMotion && read().accessibility.largeControls && read().accessibility.highContrast, 'Accessibility switches did not save');
            assert(read().ink.tool === 'arrow' && read().ink.permanent, 'Drawing options did not save');
            const scale = name => descendants(row(name)).find(widget => widget instanceof Gtk.Scale);
            scale('Volume').set_value(0.35);
            scale('Stroke width').set_value(12);
            scale('Spotlight radius').set_value(220);
            scale('Background dimming').set_value(0.6);
            scale('Horizontal position').set_value(27);
            scale('Vertical position').set_value(61);
            scale('Monitor').set_value(2);
            assert(read().sound.volume === 0.35 && read().ink.width === 12, 'Volume/width controls did not save');
            assert(read().presentation.radius === 220 && read().presentation.dim === 0.6, 'Spotlight sliders did not save');
            assert(read().toolbar.position.x === 0.27 && read().toolbar.position.y === 0.61 && read().toolbar.monitor === 2, 'Toolbar sliders did not save');
            click('Reset Position');
            assert(read().toolbar.position === null && read().toolbar.pinnedStyles[0] === 'pink', 'Toolbar reset lost pins');
            print('PASS: presentation, ink, volume, accessibility, toolbar controls and position reset.');

            row('New profile name').text = 'Talk'; click('Save Profile');
            assert(read().profiles.length === 1 && read().profiles[0].settings.ink.tool === 'arrow', 'Profile snapshot failed');
            assert(!read().profiles[0].settings.toolbar && !read().profiles[0].settings.custom, 'Profile captured unsupported sections');
            click('Save Profile');
            assert(read().profiles.length === 1, 'Duplicate profile accepted');
            row('New profile name').text = ' '; click('Save Profile');
            assert(read().profiles.length === 1, 'Empty profile accepted');
            row('Drawing tool').selected = 0;
            click('Apply Profile');
            assert(read().ink.tool === 'arrow' && read().unknown.keep === 42 && read().toolbar.extra, 'Profile application lost supported or unknown settings');
            row('Exact application ID').text = 'org.gnome.Terminal';
            row('Application action').selected = 1;
            click('Add Rule');
            assert(read().appRules[0].profile === 'Talk', 'Profile app rule not saved');
            row('Exact application ID').text = 'ORG.GNOME.TERMINAL'; click('Add Rule');
            assert(read().appRules.length === 1, 'Case-insensitive duplicate accepted');
            row('Exact application ID').text = 'org.*'; click('Add Rule');
            assert(read().appRules.length === 1, 'Wildcard rule accepted');
            row('Exact application ID').text = 'code'; row('Application action').selected = 0; click('Add Rule');
            assert(read().appRules.length === 2 && read().appRules[1].action === 'hide', 'Hide rule failed');
            const dynamicDelete = descendants(window).find(widget => widget instanceof Gtk.Button && widget.label === 'Delete Rule');
            dynamicDelete.emit('clicked');
            const respond = label => {
                const current = descendants(window).find(widget => widget instanceof Adw.PreferencesGroup && widget.title === 'Confirm deletion');
                assert(current?.visible, 'Missing inline deletion confirmation');
                const response = descendants(current).find(widget => widget instanceof Gtk.Button && widget.label === label);
                assert(response, `Missing ${label} response button`);
                response.emit('clicked');
                assert(!current.visible, 'Response left the confirmation visible');
                assert(Gtk.Window.get_toplevels().get_n_items() === 1, 'Confirmation created an extra native window');
            };
            respond('Cancel');
            assert(read().appRules.length === 2, 'Cancelling deletion changed rules');
            dynamicDelete.emit('clicked'); respond('Confirm');
            assert(read().appRules.length === 1 && read().appRules[0].appId === 'code', 'Confirmed rule deletion failed');
            click('Delete Profile'); respond('Confirm');
            assert(read().profiles.length === 0, 'Confirmed profile deletion failed');
            print('PASS: profile save/apply/delete, exact-app rules, duplicate/wildcard errors and deletion confirmations.');

            row('Toggle TinyHand').text = '<Control><Alt>h';
            row('Clear ink').text = '<Control><Alt>x';
            click('Save Shortcuts');
            assert(settings.get_string('toggle') === '<Control><Alt>h', 'Shortcut not saved');
            row('Clear ink').text = '<Control><Alt>h'; click('Save Shortcuts');
            assert(settings.get_string('clear') === '<Control><Alt>x', 'Duplicate shortcut changed settings');
            row('Clear ink').text = 'x'; click('Save Shortcuts');
            assert(settings.get_string('clear') === '<Control><Alt>x', 'Plain letter shortcut accepted');
            row('Clear ink').text = '<Bogus>NotAKey'; click('Save Shortcuts');
            assert(settings.get_string('clear') === '<Control><Alt>x', 'Invalid shortcut accepted');
            row('Clear ink').text = ''; click('Save Shortcuts');
            assert(settings.get_string('clear') === '', 'Empty shortcut did not disable binding');
            print('PASS: actual isolated GSettings shortcut saves, duplicate/invalid/plain-letter rejection, empty disables.');

            const normalized = normalizeCustomArtwork(png(true, 0x11223388, 768, 1152));
            assert(normalized.width === 384 && normalized.height === 576 && normalized.has_alpha, 'Artwork normalization/alpha failed');
            assert(normalized.get_pixels()[3] === 0x88, 'Artwork alpha was changed');
            const bytes = png(true, 0xff0000ff);
            rejects(() => normalizeCustomArtwork(new Uint8Array()), 'Empty artwork accepted');
            rejects(() => normalizeCustomArtwork(png(false, 0xff0000ff)), 'Opaque RGB artwork accepted');
            rejects(() => normalizeCustomArtwork(png(true, 0)), 'Empty alpha artwork accepted');
            rejects(() => normalizeCustomArtwork(new Uint8Array(8 * 1024 * 1024 + 1)), 'Oversize artwork accepted');
            const oversize = bytes.slice(); new DataView(oversize.buffer).setUint32(16, 4097);
            rejects(() => normalizeCustomArtwork(oversize), 'Oversize dimensions accepted');
            rejects(() => normalizeCustomArtwork(bytes.slice(0, 30)), 'Truncated artwork accepted');
            const [ok, output] = normalized.save_to_bufferv('png', [], []);
            assert(ok, 'Normalized PNG encoding failed');
            Gio.File.new_for_path(`${root}/data/tinyhand/custom/hand.png`).replace_contents(output, null, false, Gio.FileCreateFlags.PRIVATE, null);
            // Existing managed artwork can be selected, with no source asset writes.
            toggle('Spotlight');
            click('Use Custom');
            assert(read().pointer.style === 'custom' && read().custom.keep, 'Managed custom selection lost unknown config');
            scale('Horizontal anchor').set_value(0.23); scale('Vertical anchor').set_value(0.78);
            assert(read().custom.tipX === 0.23 && read().custom.tipY === 0.78, 'Anchor controls failed');
            print('PASS: PNG decoding, alpha/nonempty/size/dimension validation, normalization, managed selection and anchors.');
        } catch (error) { failed = true; printerr(`${error.message}\n${error.stack}`); }
        finally {
            // Exercise idempotent cleanup after pending notifications have settled.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                // Traversal creates wrappers for GTK's private list-item widgets.
                // Collect those borrowed test wrappers while their factories and
                // models are still alive, rather than during process shutdown.
                System.gc();
                cleanup(); cleanup(); window.close(); app.quit();
                return GLib.SOURCE_REMOVE;
            });
        }
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
if (failed) System.exit(1);
