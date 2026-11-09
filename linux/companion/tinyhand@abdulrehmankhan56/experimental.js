// Pure, shared policy for the local GNOME toolkit experiment. No desktop APIs.
export const EXPERIMENT_DEFAULTS = {
    presentation: {enabled: false, spotlight: false, radius: 140, dim: 0.45, ripples: true, keystrokes: false},
    accessibility: {reducedMotion: false, largeControls: false, highContrast: false},
    custom: {revision: '', tipX: 0.5, tipY: 0.05},
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, fallback, low, high) => Number.isFinite(value)
    ? Math.max(low, Math.min(high, value)) : fallback;
const sections = ['pointer', 'ink', 'sound', 'interaction', 'presentation', 'accessibility'];
function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (!record(value)) return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (!['__proto__', 'constructor', 'prototype'].includes(key)) result[key] = copy(child);
    }
    return result;
}

export function normalizeExperiment(input) {
    const config = copy(record(input) ? input : {});
    for (const [section, defaults] of Object.entries(EXPERIMENT_DEFAULTS)) {
        config[section] = {...defaults, ...(record(config[section]) ? config[section] : {})};
        for (const [key, fallback] of Object.entries(defaults)) {
            if (typeof fallback === 'boolean' && typeof config[section][key] !== 'boolean')
                config[section][key] = fallback;
        }
    }
    config.presentation.radius = bounded(config.presentation.radius, 140, 40, 500);
    config.presentation.dim = bounded(config.presentation.dim, 0.45, 0.1, 0.85);
    config.custom.tipX = bounded(config.custom.tipX, 0.5, 0, 1);
    config.custom.tipY = bounded(config.custom.tipY, 0.05, 0, 1);
    if (record(config.pointer)) {
        config.pointer.size = bounded(config.pointer.size, 0.13, 0.08, 0.20);
        config.pointer.style = typeof config.pointer.style === 'string' && /^[a-z0-9_-]+$/.test(config.pointer.style)
            ? config.pointer.style : 'lavender';
    }
    if (record(config.interaction)) {
        config.interaction.mode = config.interaction.mode === 'draw' ? 'draw' : 'point';
        config.interaction.hideCursor = config.interaction.hideCursor !== false;
    }
    for (const section of ['ink', 'sound', 'toolbar'])
        if (!record(config[section])) config[section] = {};
    config.ink.width = bounded(config.ink.width, 6, 2, 32);
    config.ink.fade = bounded(config.ink.fade, 3, 0, 30);
    config.ink.tool = ['freehand', 'line', 'arrow'].includes(config.ink.tool) ? config.ink.tool : 'freehand';
    config.ink.permanent = config.ink.permanent === true;
    config.sound.volume = bounded(config.sound.volume, 1, 0, 1);
    config.toolbar.collapsed = config.toolbar.collapsed === true;
    const position = config.toolbar.position;
    config.toolbar.position = record(position) && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? {x: bounded(position.x, 0.5, 0, 1), y: bounded(position.y, 1, 0, 1)} : null;
    config.toolbar.monitor = Number.isInteger(config.toolbar.monitor) && config.toolbar.monitor >= 0
        ? config.toolbar.monitor : 0;
    config.profiles = Array.isArray(config.profiles) ? config.profiles.filter(profile =>
        record(profile) && typeof profile.name === 'string' && profile.name.trim().length > 0 &&
        profile.name.length <= 60 && record(profile.settings)).slice(0, 20) : [];
    config.appRules = Array.isArray(config.appRules) ? config.appRules.filter(rule =>
        record(rule) && typeof rule.appId === 'string' && rule.appId.trim().length > 0 &&
        rule.appId.length <= 200 && ['hide', 'profile'].includes(rule.action)).slice(0, 50) : [];
    return config;
}

export function snapshotProfile(config) {
    const snapshot = {};
    for (const section of sections) if (record(config[section])) snapshot[section] = copy(config[section]);
    return snapshot;
}

export function profilePatch(config, name) {
    const profile = config.profiles?.find(item => item.name === name);
    return profile ? snapshotProfile(profile.settings) : null;
}

export function appOverride(config, appId) {
    if (typeof appId !== 'string' || !appId) return config;
    const rule = config.appRules?.find(item => item.appId.toLowerCase() === appId.toLowerCase());
    if (!rule) return config;
    if (rule.action === 'hide') return {...config, enabled: false};
    const patch = profilePatch(config, rule.profile);
    if (!patch) return config;
    const result = {...config};
    for (const [section, values] of Object.entries(patch)) result[section] = {...config[section], ...values};
    return normalizeExperiment(result);
}

export function toolbarPosition(config, area, width, height) {
    const roomX = Math.max(0, area.width - width - 24);
    const roomY = Math.max(0, area.height - height - 24);
    return [area.x + Math.min(12, Math.max(0, (area.width - width) / 2)) + roomX * (config.toolbar?.position?.x ?? 0.5),
        area.y + Math.min(12, Math.max(0, (area.height - height) / 2)) + roomY * (config.toolbar?.position?.y ?? 1)];
}
