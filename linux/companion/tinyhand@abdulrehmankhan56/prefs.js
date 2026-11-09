import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {buildPreferences} from './preferences.js';

export default class TinyHandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        buildPreferences(window, null, this.getSettings());
    }
}
