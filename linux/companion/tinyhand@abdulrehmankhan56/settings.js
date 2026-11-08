// Standalone entry point, so settings can open without reloading GNOME Shell.
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import {buildPreferences} from './preferences.js';

const app = new Adw.Application({application_id: 'io.github.AbdulRehman56.TinyHand.Settings'});
app.connect('activate', () => {
    if (app.active_window) {
        app.active_window.present();
        return;
    }
    const window = new Adw.PreferencesWindow({application: app, title: 'TinyHand',
        default_width: 620, default_height: 740, search_enabled: false});
    buildPreferences(window);
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
