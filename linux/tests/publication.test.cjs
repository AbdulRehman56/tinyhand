const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('default publication never inspects, pushes, or modifies the upstream PR', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyhand-publish-test.'));
    try {
        const bin = path.join(sandbox, 'bin');
        const log = path.join(sandbox, 'commands.log');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env bash
set -eu
printf 'git %s\\n' "$*" >> "$TEST_LOG"
case "$1" in
  branch) echo linux-port ;;
  diff|ls-files|status) ;;
  rev-parse) echo 0123456789012345678901234567890123456789 ;;
  -c) ;;
  *) echo "Unexpected git operation: $*" >&2; exit 95 ;;
esac
`, {mode: 0o755});
        fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
set -eu
printf 'gh %s\\n' "$*" >> "$TEST_LOG"
case "$1 $2" in
  'auth status'|'repo edit'|'run watch') ;;
  'repo view') echo PUBLIC ;;
  'run list') echo 123 ;;
  'release view') echo https://example.invalid/release ;;
  *) echo "Unexpected GitHub operation: $*" >&2; exit 96 ;;
esac
`, {mode: 0o755});
        const script = path.join(__dirname, '../scripts/publish.sh');
        const result = spawnSync('bash', [script], {encoding: 'utf8', timeout: 15000,
            env: {...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_LOG: log}});
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const commands = fs.readFileSync(log, 'utf8');
        assert.match(commands, /push.*linux-port:refs\/heads\/linux-port/);
        assert.doesNotMatch(commands, /linux-port-upstream|gh pr |gh api |git worktree|git fetch/);
        assert.match(result.stdout, /Upstream PR is paused/);
    } finally {
        fs.rmSync(sandbox, {recursive: true, force: true});
    }
});
