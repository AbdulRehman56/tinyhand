// Standalone entry point, so settings can open without reloading GNOME Shell.
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {buildPreferences} from './preferences.js';

const experiment = ARGV.includes('--experiment');
const app = new Adw.Application({application_id: experiment
    ? 'io.github.AbdulRehman56.TinyHand.Settings.Experiment' : 'io.github.AbdulRehman56.TinyHand.Settings',
    flags: experiment ? Gio.ApplicationFlags.NON_UNIQUE : Gio.ApplicationFlags.FLAGS_NONE});
app.connect('activate', () => {
    if (app.active_window) {
        app.active_window.present();
        return;
    }
    const window = new Adw.PreferencesWindow({application: app, title: 'TinyHand',
        default_width: 620, default_height: 740, search_enabled: false});
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup('org.gnome.shell.extensions.tinyhand', true);
    buildPreferences(window, null, schema ? new Gio.Settings({settings_schema: schema}) : null);
    if (experiment) window.set_title('TinyHand Local Experiment — isolated settings');
    if (ARGV.includes('--smoke-test')) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            print('TinyHand settings window constructed successfully.');
            window.close();
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    } else {
        window.present();
    }
});
app.run([]);
