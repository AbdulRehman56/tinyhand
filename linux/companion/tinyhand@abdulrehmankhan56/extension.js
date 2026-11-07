import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gdk from 'gi://Gdk?version=3.0';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
// Cairo is a built-in GJS module, not a GI typelib.
import cairo from 'cairo';

const DEFAULTS = {
    enabled: true,
    pointer: {style: 'lavender', size: 0.13, shadow: true},
    ink: {choice: 'match', fade: 3.0},
    sound: {hand: true, laser: false, tap: 'thock'},
    interact: {key: 'alt', keepsHand: false},
    hotkeys: {},
    seenWelcome: false,
};
const DEFAULT_PINNED = ['lavender', 'glove', 'coral', 'plush', 'robot', 'laser'];
const COLORS = {
    red: [1, 0.16, 0.12], orange: [1, 0.54, 0], yellow: [1, 0.8, 0],
    green: [0.19, 0.76, 0.35], blue: [0.04, 0.52, 1], purple: [0.53, 0.33, 0.95],
    white: [1, 1, 1], black: [0.11, 0.11, 0.13],
};
const STYLE_INK = {
    lavender: 'purple', glove: 'purple', coral: 'red', plush: 'blue', robot: 'green',
    pink: 'purple', blue: 'blue', mint: 'green', lemon: 'red', black: 'black',
    chrome: 'white', holo: 'purple', fuzzy: 'purple', wood: 'orange', marble: 'white',
    terrazzo: 'red', glass: 'blue', jelly: 'purple', pastel: 'purple', pixel: 'black',
    lowpoly: 'purple', knit: 'purple', skeleton: 'orange', astro: 'blue', space: 'red',
    monster: 'green', water: 'blue', lava: 'red', grass: 'green', cactus: 'green',
    choco: 'orange', cloud: 'blue', mech: 'red', neon: 'purple', leaf: 'green', cookie: 'orange',
    laser: 'red',
};
const BINDINGS = ['toggle', 'clear', 'cycle'];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const now = () => GLib.get_monotonic_time() / 1e6;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(base, extra) {
    // Never share nested defaults with live configuration objects.
    const result = {};
    for (const [key, value] of Object.entries(base)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        result[key] = object(value) ? merge(value, {}) : value;
    }
    if (!object(extra))
        return result;
    for (const [key, value] of Object.entries(extra)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        result[key] = object(value) && object(base[key]) ? merge(base[key], value) : value;
    }
    return result;
}

function readJson(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        const value = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
        return object(value) ? value : {};
    } catch (_) {
        return {};
    }
}

function writeJson(path, value) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    GLib.file_set_contents(path, JSON.stringify(value, null, 2));
}

export default class TinyHandExtension extends Extension {
    enable() {
        this._sources = new Set();
        this._signals = [];
        this._bound = [];
        this._assets = new Map();
        this._strokes = [];
        this._active = null;
        this._press = 0;
        this._gripX = null;
        this._last = null;
        this._held = false;
        this._dirty = true;
        this._running = true;
        this._configPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'tinyhand', 'config.json']);
        this._geometryPath = GLib.build_filenamev([GLib.get_user_cache_dir(), 'tinyhand', 'hand-geometry.json']);
        this._geometry = readJson(this._geometryPath);
        this._assetDir = this._findAssets();
        this._config = this._readConfig();

        this._area = new St.DrawingArea({reactive: false, track_hover: false, can_focus: false});
        this._connect(this._area, 'repaint', () => this._paint());
        global.stage.add_child(this._area);
        this._createToolbar();
        this._connect(global.stage, 'notify::width', () => this._resize());
        this._connect(global.stage, 'notify::height', () => this._resize());
        this._connect(this._toolbar, 'notify::width', () => this._positionToolbar());
        this._resize();

        try {
            this._settings = this.getSettings();
            this._bindingSettings = this.getSettings('org.gnome.shell.extensions.tinyhand.bindings');
            for (const name of BINDINGS) {
                const sync = () => {
                    const accelerator = this._settings.get_string(name);
                    this._bindingSettings.set_strv(name, accelerator ? [accelerator] : []);
                };
                sync();
                this._connect(this._settings, `changed::${name}`, sync);
                // Actual GNOME signature: (name, settings, Meta flags, Shell modes, callback).
                Main.wm.addKeybinding(name, this._bindingSettings, Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.ALL, () => {
                        if (name === 'toggle') this._toggle();
                        else if (name === 'clear') this._clear();
                        else this._cycle();
                    });
                this._bound.push(name);
            }
            this._connect(this._settings, 'changed::show-toolbar', () => this._visibility());
        } catch (error) {
            console.warn(`TinyHand: compile/install the settings schema to enable shortcuts: ${error}`);
        }
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._configPath), 0o700);
            this._monitor = Gio.File.new_for_path(this._configPath).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._connect(this._monitor, 'changed', () => this._reload());
        } catch (error) {
            console.warn(`TinyHand: cannot watch configuration: ${error}`);
        }
        this._visibility();
        this._schedule(16);
    }

    _connect(object_, signal, callback) {
        this._signals.push([object_, object_.connect(signal, callback)]);
    }

    _readConfig() {
        const config = merge(DEFAULTS, readJson(this._configPath));
        for (const key of ['pointer', 'ink', 'sound', 'interact', 'hotkeys']) {
            if (!object(config[key])) config[key] = {...DEFAULTS[key]};
        }
        config.enabled = typeof config.enabled === 'boolean' ? config.enabled : true;
        config.pointer.style = typeof config.pointer.style === 'string' && /^[a-z0-9_-]+$/.test(config.pointer.style)
            ? config.pointer.style : 'lavender';
        config.pointer.size = Number.isFinite(config.pointer.size) ? clamp(config.pointer.size, 0.08, 0.20) : 0.13;
        config.ink.fade = Number.isFinite(config.ink.fade) ? config.ink.fade : 3;
        return config;
    }

    _reload() {
        const oldStyle = this._config.pointer.style;
        this._config = this._readConfig();
        if (oldStyle !== this._config.pointer.style)
            this._assets.delete(oldStyle);
        if (!this._config.enabled)
            this._finishStroke();
        // A formerly missing asset directory may now have been installed.
        if (!this._assetDir) {
            this._assetDir = this._findAssets();
            this._assets.clear();
        }
        this._dirty = true;
        this._visibility();
    }

    _update(patch) {
        try {
            // Merge into the latest disk contents, not our defaults, preserving other clients' keys.
            writeJson(this._configPath, merge(readJson(this._configPath), patch));
            this._reload();
        } catch (error) {
            console.warn(`TinyHand: cannot save configuration: ${error}`);
            this._config = merge(this._config, patch);
            this._dirty = true;
            this._visibility();
        }
    }

    _findAssets() {
        const candidates = [GLib.build_filenamev([GLib.get_user_data_dir(), 'tinyhand', 'assets'])];
        let dir = this.path;
        while (dir) {
            candidates.push(GLib.build_filenamev([dir, 'assets']));
            const parent = GLib.path_get_dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        candidates.push(GLib.build_filenamev([GLib.get_home_dir(), 'Documents', 'Projects', 'tinyhand', 'assets']));
        return candidates.find(path => GLib.file_test(path, GLib.FileTest.IS_DIR)) ?? null;
    }

    _toggle() {
        this._finishStroke();
        this._update({enabled: !this._config.enabled});
    }

    _cycle() {
        const i = DEFAULT_PINNED.indexOf(this._config.pointer.style);
        this._update({pointer: {style: DEFAULT_PINNED[(i + 1) % DEFAULT_PINNED.length]}});
    }

    _clear() {
        this._strokes = [];
        this._active = null;
        this._dirty = true;
    }

    _createToolbar() {
        this._toolbar = new St.BoxLayout({
            vertical: false, reactive: true, style_class: 'tinyhand-toolbar',
            style: 'background-color: rgba(0,0,0,0.55); border-radius: 14px; padding: 8px; spacing: 6px;',
        });
        const button = (text, description, callback) => {
            const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER});
            const actor = new St.Button({child: label, reactive: true, can_focus: true,
                accessible_name: description, style: 'min-width: 28px; min-height: 28px; padding: 0px;'});
            this._connect(actor, 'clicked', callback);
            this._toolbar.add_child(actor);
            return label;
        };
        button('🖐', 'Cycle hand style', () => this._cycle());
        this._soundLabel = button('🔊', 'Toggle tap sounds', () => this._update({sound: {hand: !this._config.sound.hand}}));
        button('🧽', 'Clear ink', () => this._clear());
        button('✕', 'Hide TinyHand', () => this._update({enabled: false}));
        global.stage.add_child(this._toolbar);
    }

    _positionToolbar() {
        this._toolbar.set_position(Math.max(0, (global.stage.width - this._toolbar.width) / 2),
            Math.max(0, global.stage.height - 70));
    }

    _resize() {
        this._area.set_size(global.stage.width, global.stage.height);
        this._positionToolbar();
        this._dirty = true;
    }

    _visibility() {
        this._area.visible = this._config.enabled;
        this._toolbar.visible = this._config.enabled && (this._settings?.get_boolean('show-toolbar') ?? true);
        this._soundLabel.text = this._config.sound.hand ? '🔊' : '🔇';
    }

    _schedule(ms) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._sources.delete(id);
            if (!this._running) return GLib.SOURCE_REMOVE;
            let delay = 48;
            try {
                delay = this._tick();
            } catch (error) {
                console.warn(`TinyHand: update failed: ${error}`);
            }
            if (this._running) this._schedule(delay);
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
    }

    _tick() {
        const [x, y, mods] = global.get_pointer();
        const held = (mods & 0x100) !== 0;
        const down = held && !this._held;
        const moved = !this._last || x !== this._last[0] || y !== this._last[1];
        this._held = held;
        this._last = [x, y];
        if (!this._config.enabled) {
            this._finishStroke();
            return 48;
        }
        if (down) {
            this._press = 1;
            this._tap();
        } else if (!held) {
            this._press *= 0.82;
            if (this._press < 0.002) this._press = 0;
        }
        const target = clamp(x + 0.30 * global.stage.width, 0.15 * global.stage.width, 1.05 * global.stage.width);
        this._gripX = this._gripX === null ? target : this._gripX + (target - this._gripX) * 0.08;
        const settling = Math.abs(target - this._gripX) > 0.5;
        if (!settling) this._gripX = target;
        // Toolbar clicks must not leave ink or trigger an underlying application.
        const overToolbar = this._toolbar.visible && x >= this._toolbar.x && y >= this._toolbar.y &&
            x <= this._toolbar.x + this._toolbar.width && y <= this._toolbar.y + this._toolbar.height;
        if (held && !overToolbar) {
            if (!this._active) {
                const choice = this._config.ink.choice;
                const color = COLORS[choice === 'match' ? STYLE_INK[this._config.pointer.style] : choice] ?? COLORS.purple;
                this._active = {points: [[x, y]], color, start: now()};
                this._strokes.push(this._active);
            } else if (moved) {
                this._active.points.push([x, y]);
            }
            this._active.start = now();
        } else {
            this._finishStroke();
        }
        const time = now();
        const previousCount = this._strokes.length;
        this._strokes = this._strokes.filter(stroke => stroke === this._active || this._alpha(stroke, time) > 0);
        const fading = this._config.ink.fade > 0 && this._strokes.length > 0;
        const busy = moved || held || this._press > 0 || settling || fading;
        if (busy || this._dirty || previousCount !== this._strokes.length) {
            this._area.queue_repaint();
            this._dirty = false;
        }
        return busy ? 16 : 48;
    }

    _finishStroke() {
        if (this._active) this._active.start = now();
        this._active = null;
    }

    _alpha(stroke, time) {
        const fade = this._config.ink.fade;
        return stroke === this._active || fade <= 0 ? 1 : clamp(1 - (time - stroke.start - fade) / 0.6, 0, 1);
    }

    _tap() {
        const laser = this._config.pointer.style === 'laser';
        if (laser ? !this._config.sound.laser : !this._config.sound.hand) return;
        const tap = laser ? 'boop' : this._config.sound.tap;
        if (!this._assetDir || typeof tap !== 'string' || !/^[a-z0-9_-]+$/.test(tap)) return;
        const wav = GLib.build_filenamev([this._assetDir, 'sounds', `tap_${tap}.wav`]);
        if (!GLib.file_test(wav, GLib.FileTest.IS_REGULAR)) return;
        try {
            GLib.spawn_command_line_async(`paplay ${GLib.shell_quote(wav)}`);
        } catch (_) {
            // Sound is optional (e.g. paplay may not be installed).
        }
    }

    _measure(pixbuf) {
        const w = pixbuf.width, h = pixbuf.height;
        const stride = pixbuf.rowstride, channels = pixbuf.n_channels;
        const pixels = pixbuf.get_pixels();
        const rows = [];
        for (let y = 0; y < h; y++) {
            let first = -1, last = -1, count = 0;
            for (let x = 0; x < w; x++) {
                if (!pixbuf.has_alpha || pixels[y * stride + x * channels + channels - 1] > 128) {
                    if (first < 0) first = x;
                    last = x;
                    count++;
                }
            }
            rows.push({first, last, count});
        }
        const top = rows.findIndex(row => row.count > 0);
        if (top < 0) throw new Error('Empty hand image');
        let maxWidth = 0;
        for (let y = top; y < Math.min(h, top + 0.45 * h); y++)
            maxWidth = Math.max(maxWidth, rows[y].count);
        const fist = rows.findIndex((row, y) => y >= top && row.count > 0.6 * maxWidth);
        const wrist = rows.findIndex((row, y) => y > fist && row.count < 0.35 * maxWidth);
        if (wrist <= top || wrist >= h - 1) throw new Error('Invalid hand wrist');
        const rodWidth = rows[Math.min(wrist + Math.floor(h / 50), h - 1)].count;
        let rodEnd = rows.findIndex((row, y) => y >= wrist + Math.floor(h / 33) && row.count > 1.8 * rodWidth);
        if (rodEnd < 0) {
            rodEnd = h - 1;
            while (rodEnd > wrist && rows[rodEnd].count === 0) rodEnd--;
        }
        if (rodEnd <= wrist || rodWidth === 0) throw new Error('Invalid hand rod');
        const populatedRow = index => {
            if (rows[index].count > 0) return rows[index];
            for (let distance = 1; distance < h; distance++) {
                for (const y of [index - distance, index + distance]) {
                    if (y >= top && y < h && rows[y].count > 0) return rows[y];
                }
            }
            return rows[top];
        };
        const tipRow = populatedRow(Math.min(top + Math.floor(h / 200), h - 1));
        const rodRow = populatedRow(Math.floor((wrist + rodEnd) / 2));
        let minX = w, maxX = 0;
        for (let y = top; y < wrist; y++) {
            if (!rows[y].count) continue;
            minX = Math.min(minX, rows[y].first);
            maxX = Math.max(maxX, rows[y].last);
        }
        return {aspect: w / h, handTop: Math.max(0, top - 0.004 * h) / h,
            tip: top / h, wrist: wrist / h, rodEnd: rodEnd / h,
            tipX: (tipRow.first + tipRow.last) / 2 / w, rodX: (rodRow.first + rodRow.last) / 2 / w,
            handMinX: minX / w, handMaxX: maxX / w};
    }

    _validGeometry(g) {
        return object(g) && ['aspect', 'handTop', 'tip', 'wrist', 'rodEnd', 'tipX', 'rodX', 'handMinX', 'handMaxX']
            .every(key => Number.isFinite(g[key])) && g.aspect > 0 && g.handTop >= 0 &&
            g.handTop <= g.tip && g.tip < g.wrist && g.wrist < g.rodEnd && g.rodEnd <= 1 &&
            g.tipX >= 0 && g.tipX <= 1 && g.rodX >= 0 && g.rodX <= 1;
    }

    _asset(style) {
        if (this._assets.has(style)) return this._assets.get(style);
        let asset = null;
        try {
            if (!this._assetDir) return null;
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(GLib.build_filenamev([this._assetDir, `hand_${style}.png`]));
            let g = this._geometry[style];
            if (!this._validGeometry(g)) {
                g = this._measure(pixbuf);
                this._geometry[style] = g;
                try { writeJson(this._geometryPath, this._geometry); } catch (_) { /* Cache is optional. */ }
            }
            const top = clamp(Math.floor(g.handTop * pixbuf.height), 0, pixbuf.height - 2);
            const wrist = clamp(Math.floor(g.wrist * pixbuf.height), top + 1, pixbuf.height - 1);
            const end = clamp(Math.floor(g.rodEnd * pixbuf.height), wrist + 1, pixbuf.height);
            // Construct immutable black RGBA storage once; keep GLib.Bytes alive with its pixbuf.
            const source = pixbuf.get_pixels();
            const black = new Uint8Array(pixbuf.width * pixbuf.height * 4);
            for (let y = 0; y < pixbuf.height; y++) {
                for (let x = 0; x < pixbuf.width; x++) {
                    black[(y * pixbuf.width + x) * 4 + 3] = pixbuf.has_alpha
                        ? source[y * pixbuf.rowstride + x * pixbuf.n_channels + pixbuf.n_channels - 1] : 255;
                }
            }
            const bytes = new GLib.Bytes(black);
            const shadow = GdkPixbuf.Pixbuf.new_from_bytes(bytes, GdkPixbuf.Colorspace.RGB, true,
                8, pixbuf.width, pixbuf.height, pixbuf.width * 4);
            const slice = (image, y, height) => image.new_subpixbuf(0, y, image.width, height);
            asset = {g, width: pixbuf.width, hand: slice(pixbuf, top, wrist - top),
                rod: slice(pixbuf, wrist, end - wrist), shadowHand: slice(shadow, top, wrist - top),
                shadowRod: slice(shadow, wrist, end - wrist), bytes};
        } catch (error) {
            console.warn(`TinyHand: cannot load hand ${style}: ${error}`);
        }
        this._assets.set(style, asset);
        return asset;
    }

    _paint() {
        const cr = this._area.get_context();
        try {
            cr.setOperator(cairo.Operator.SOURCE);
            cr.setSourceRGBA(0, 0, 0, 0);
            cr.paint();
            cr.setOperator(cairo.Operator.OVER);
            if (!this._config.enabled || !this._last) return;
            this._paintInk(cr);
            if (this._config.pointer.style === 'laser') this._paintLaser(cr);
            else this._paintHand(cr);
        } catch (error) {
            console.warn(`TinyHand: paint failed: ${error}`);
        } finally {
            cr.$dispose();
        }
    }

    _paintInk(cr) {
        const time = now();
        const width = Math.max(3, global.stage.height * 0.0055);
        cr.setLineWidth(width);
        cr.setLineCap(cairo.LineCap.ROUND);
        cr.setLineJoin(cairo.LineJoin.ROUND);
        for (const stroke of this._strokes) {
            const points = stroke.points;
            if (!points.length) continue;
            cr.setSourceRGBA(...stroke.color, this._alpha(stroke, time));
            if (points.length === 1) {
                cr.arc(points[0][0], points[0][1], width / 2, 0, Math.PI * 2);
                cr.fill();
                continue;
            }
            let current = points[0];
            cr.moveTo(...current);
            for (let i = 1; i < points.length; i++) {
                const control = points[i - 1];
                const end = [(control[0] + points[i][0]) / 2, (control[1] + points[i][1]) / 2];
                // Cairo has cubic curves only: exactly convert the specified quadratic.
                cr.curveTo(current[0] + 2 / 3 * (control[0] - current[0]),
                    current[1] + 2 / 3 * (control[1] - current[1]),
                    end[0] + 2 / 3 * (control[0] - end[0]), end[1] + 2 / 3 * (control[1] - end[1]), ...end);
                current = end;
            }
            cr.lineTo(...points[points.length - 1]);
            cr.stroke();
        }
    }

    _paintLaser(cr) {
        const [x, y] = this._last;
        const r = Math.max(4, global.stage.height * 0.0038 * this._config.pointer.size / 0.13) * (1 + 0.2 * this._press);
        const glow = new cairo.RadialGradient(x, y, 0, x, y, r * 3.2);
        glow.addColorStopRGBA(0, 1, 40 / 255, 30 / 255, 0.43);
        glow.addColorStopRGBA(1, 1, 40 / 255, 30 / 255, 0);
        cr.setSource(glow);
        cr.arc(x, y, r * 3.2, 0, Math.PI * 2);
        cr.fill();
        cr.setSourceRGBA(1, 40 / 255, 30 / 255, 1);
        cr.setLineWidth(Math.max(1, r * 0.12));
        cr.arc(x, y, r, 0, Math.PI * 2);
        cr.stroke();
        cr.setSourceRGBA(1, 219 / 255, 209 / 255, 0.95);
        cr.arc(x, y, r * 0.45, 0, Math.PI * 2);
        cr.fill();
    }

    _paintHand(cr) {
        const asset = this._asset(this._config.pointer.style);
        if (!asset || this._gripX === null) return;
        const g = asset.g;
        const H = global.stage.height;
        const handPts = this._config.pointer.size * H * (1 - 0.06 * this._press);
        const s = handPts / (g.wrist - g.handTop);
        const widthPts = s * g.aspect;
        const handTipPts = (g.wrist - g.tip) * s;
        const tipOffX = (g.tipX - g.rodX) * widthPts;
        const gx = this._gripX, gy = 1.12 * H;
        const dx = this._last[0] - gx, dy = this._last[1] - gy;
        const reach = Math.hypot(dx, dy);
        const along = Math.sqrt(Math.max(0, reach * reach - tipOffX * tipOffX));
        // Preserve the native minimum length. If this clamp binds (e.g. the
        // bottom-right corner), exact fingertip coincidence is geometrically
        // impossible without changing the specified grip, hand size or minimum.
        const rodLen = Math.max(0.05 * H, along - handTipPts);
        const rotation = Math.atan2(dy, dx) - Math.atan2(-(rodLen + handTipPts), tipOffX);
        const draw = (hand, rod, alpha, offsetX = 0, offsetY = 0) => {
            cr.save();
            cr.translate(gx, gy);
            cr.translate(offsetX, offsetY);
            cr.rotate(rotation);
            for (const [image, y, height] of [[rod, -rodLen, rodLen], [hand, -rodLen - handPts, handPts]]) {
                cr.save();
                cr.translate(-g.rodX * widthPts, y);
                cr.scale(widthPts / asset.width, height / image.height);
                Gdk.cairo_set_source_pixbuf(cr, image, 0, 0);
                cr.paintWithAlpha(alpha);
                cr.restore();
            }
            cr.restore();
        };
        if (this._config.pointer.shadow) {
            const lift = 0.06 * H * (1 - 0.8 * this._press);
            const angle = -rotation;
            const sx = lift * 0.6 * Math.cos(angle) - lift * Math.sin(angle);
            const sy = lift * 0.6 * Math.sin(angle) + lift * Math.cos(angle);
            draw(asset.shadowHand, asset.shadowRod, 0.26 + 0.02 * this._press, sx, sy);
        }
        draw(asset.hand, asset.rod, 1);
    }

    disable() {
        this._running = false;
        for (const id of this._sources ?? []) GLib.source_remove(id);
        this._sources?.clear();
        for (const [object_, id] of this._signals ?? []) object_.disconnect(id);
        this._signals = null;
        this._monitor?.cancel();
        this._monitor = null;
        for (const name of this._bound ?? []) Main.wm.removeKeybinding(name);
        this._area?.destroy();
        this._toolbar?.destroy();
        this._assets?.clear();
        this._area = null;
        this._toolbar = null;
        this._soundLabel = null;
        this._settings = null;
        this._bindingSettings = null;
        this._assets = null;
        this._geometry = null;
        this._strokes = null;
        this._active = null;
        this._last = null;
        this._config = null;
        this._sources = null;
        this._bound = null;
        this._assetDir = null;
    }
}
