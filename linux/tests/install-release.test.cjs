const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function fixture() {
    fs.mkdirSync('/tmp/opencode', {recursive: true});
    const root = fs.mkdtempSync('/tmp/opencode/tinyhand-installer-test.');
    const bundle = path.join(root, 'bundle');
    const home = path.join(root, 'home with spaces');
    for (const dir of ['bin', 'share/tinyhand/settings', 'share/tinyhand/assets'])
        fs.mkdirSync(path.join(bundle, dir), {recursive: true});
    fs.copyFileSync(path.join(__dirname, '../scripts/install-release.sh'), path.join(bundle, 'install.sh'));
    for (const name of ['tinyhand', 'tinyhand-settings'])
        fs.writeFileSync(path.join(bundle, 'bin', name), '#!/bin/sh\necho tinyhand-fixture\n', {mode: 0o755});
    for (const name of ['settings', 'preferences', 'experimental'])
        fs.writeFileSync(path.join(bundle, 'share/tinyhand/settings', `${name}.js`), `// ${name} fixture\n`);
    fs.writeFileSync(path.join(bundle, 'share/tinyhand/assets/hand_lavender.png'), 'artwork fixture');
    const run = (...args) => spawnSync('bash', [path.join(bundle, 'install.sh'), ...args],
        {env: {...process.env, HOME: home}, encoding: 'utf8', timeout: 15000});
    return {root, bundle, home, run};
}

test('portable installer includes shared module and preserves user data on uninstall', () => {
    const {root, bundle, home, run} = fixture();
    try {
        const data = path.join(home, '.local/share/tinyhand');
        const config = path.join(home, '.config/tinyhand/config.json');
        const sentinel = path.join(home, '.local/share/gnome-shell/extensions/sentinel');
        for (const file of [config, sentinel, path.join(data, 'custom/hand.png')]) {
            fs.mkdirSync(path.dirname(file), {recursive: true});
            fs.writeFileSync(file, 'preserved');
        }
        const installed = run();
        assert.equal(installed.status, 0, installed.stderr);
        for (const name of ['settings', 'preferences', 'experimental'])
            assert.equal(fs.readFileSync(path.join(data, 'settings', `${name}.js`), 'utf8'),
                fs.readFileSync(path.join(bundle, 'share/tinyhand/settings', `${name}.js`), 'utf8'));
        const removed = run('--uninstall');
        assert.equal(removed.status, 0, removed.stderr);
        assert.equal(fs.existsSync(path.join(data, 'settings')), false);
        assert.equal(fs.existsSync(path.join(home, '.local/bin/tinyhand')), false);
        for (const file of [config, sentinel, path.join(data, 'custom/hand.png')])
            assert.equal(fs.readFileSync(file, 'utf8'), 'preserved');
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('portable installer rejects missing shared module before writing installed files', () => {
    const {root, bundle, home, run} = fixture();
    try {
        fs.unlinkSync(path.join(bundle, 'share/tinyhand/settings/experimental.js'));
        const result = run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Incomplete bundle: missing .*experimental\.js/);
        assert.equal(fs.existsSync(path.join(home, '.local/bin/tinyhand')), false);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
