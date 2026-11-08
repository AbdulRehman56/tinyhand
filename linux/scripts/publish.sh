#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  cat <<'EOF'
Usage: ./linux/scripts/publish.sh

Commit the reviewed publication files on linux-port, prepare an upstream
branch with a minimal README addition, push both to the public fork, make
linux-port its default, open the upstream draft PR, and wait for the checked
GitHub Actions prerelease. Requires Git, Python 3, tar, authenticated GitHub
CLI (gh), a writable .git directory, network access, and permission to publish.
Does not submit the extension to extensions.gnome.org.
EOF
  exit 0
fi
[[ $# == 0 ]] || { printf 'Use --help for usage.\n' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$ROOT"
command -v gh >/dev/null || { printf 'Install GitHub CLI and run gh auth login first.\n' >&2; exit 1; }
for dependency in python3 tar; do command -v "$dependency" >/dev/null; done
[[ $(git branch --show-current) == linux-port ]] || { printf 'Run from the linux-port branch.\n' >&2; exit 1; }
reviewed_files=(
  README.md linux/.gitignore linux/README.md linux/CONTRIBUTING.md linux/COMPATIBILITY.md
  linux/RELEASE_NOTES.md linux/UPSTREAM_PR.md linux/src/config.rs
  linux/companion/tinyhand@abdulrehmankhan56/extension.js
  linux/companion/tinyhand@abdulrehmankhan56/metadata.json
  linux/companion/tinyhand@abdulrehmankhan56/preferences.js
  linux/tests/companion-render.mjs linux/tests/companion.test.cjs
  linux/scripts/install-release.sh linux/scripts/package.sh linux/scripts/publish.sh
  .github/workflows/linux.yml
)
git diff --cached --quiet || { printf 'Preserve or commit your staged changes first.\n' >&2; exit 1; }
while IFS= read -r -d '' changed_path; do
  allowed=false
  for path in "${reviewed_files[@]}"; do
    if [[ "$changed_path" == "$path" ]]; then allowed=true; break; fi
  done
  $allowed || { printf 'Preserve unrelated changes to %s before publishing.\n' "$changed_path" >&2; exit 1; }
done < <(git diff --name-only -z HEAD; git ls-files --others --exclude-standard -z)
if [[ -n $(git status --porcelain) ]]; then
  git add -- "${reviewed_files[@]}"
  git diff --cached --check
  git commit -m 'release(linux): prepare attributed GNOME and X11 prerelease'
fi
gh auth status --active >/dev/null
[[ $(gh repo view AbdulRehman56/tinyhand --json visibility --jq .visibility) == PUBLIC ]] || {
  printf 'Expected the existing public fork; refusing to change repository visibility.\n' >&2
  exit 1
}
if ! git show-ref --verify --quiet refs/heads/linux-port-upstream; then
  git fetch https://github.com/nilbuild/tinyhand.git main
  upstream_base=$(git rev-parse FETCH_HEAD)
  pr_worktree=$(mktemp -d /tmp/opencode/tinyhand-upstream.XXXXXX)
  git worktree add -b linux-port-upstream "$pr_worktree" "$upstream_base"
  git archive linux-port linux .github/workflows/linux.yml | tar -x -C "$pr_worktree"
  python3 - "$pr_worktree/README.md" <<'PY'
import sys
from pathlib import Path
readme = Path(sys.argv[1])
source = readme.read_text()
marker = '## License\n'
if marker not in source:
    raise SystemExit('Upstream README changed; add the Linux section manually before publishing.')
section = '''## Experimental Linux port

An optional Linux implementation is available in [linux/](./linux/README.md):
a GNOME Shell 45–50 companion for Wayland and a Rust X11 app, with visual settings
and per-user installation. GNOME 45–49 are experimental (API/mocks only); 50.1 is
the only desktop-tested version. Settings need GTK 4.8+ and libadwaita 1.4+.
See the compatibility assessment for limits; full macOS parity remains incomplete.

TinyHand's original app, concept, artwork and sounds are by
[Kamran Ahmed (@nilbuild)](https://github.com/nilbuild). The independent Linux
port is maintained by [AbdulRehman56](https://github.com/AbdulRehman56).
See the [Linux guide](./linux/README.md) for installation, packaging and known gaps.

'''
readme.write_text(source.replace(marker, section + marker, 1))
PY
  git -C "$pr_worktree" add README.md linux .github/workflows/linux.yml
  git -C "$pr_worktree" diff --cached --check
  git -C "$pr_worktree" commit -m 'feat(linux): propose experimental GNOME and X11 port'
  git worktree remove "$pr_worktree"
fi
for path in linux .github/workflows/linux.yml; do
  [[ $(git rev-parse "linux-port:$path") == $(git rev-parse "linux-port-upstream:$path") ]] || {
    printf 'The prepared upstream branch is stale for %s; update it before publishing.\n' "$path" >&2
    exit 1
  }
done
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push --atomic \
  https://github.com/AbdulRehman56/tinyhand.git \
  linux-port:refs/heads/linux-port linux-port-upstream:refs/heads/linux-port-upstream
gh repo edit AbdulRehman56/tinyhand --default-branch linux-port \
  --description 'Independent Linux port of TinyHand by Kamran Ahmed (@nilbuild). GNOME 45-50 (45-49 experimental) and X11.'
pr_url=$(gh pr list --repo nilbuild/tinyhand --state open \
  --head AbdulRehman56:linux-port-upstream --json url --jq '.[0].url // empty')
if [[ -z "$pr_url" ]]; then
  pr_url=$(gh pr create --repo nilbuild/tinyhand --base main \
    --head AbdulRehman56:linux-port-upstream --draft \
    --title 'Add experimental Linux port (GNOME 45-50 and X11)' \
    --body-file linux/UPSTREAM_PR.md)
fi
printf 'Upstream PR: %s\n' "$pr_url"
commit_sha=$(git rev-parse linux-port)
find_run() {
  local run_id=''
  for attempt in {1..15}; do
    run_id=$(gh run list --repo AbdulRehman56/tinyhand --workflow linux.yml \
      --branch linux-port --commit "$commit_sha" --limit 1 \
      --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
    if [[ -n "$run_id" ]]; then printf '%s\n' "$run_id"; return 0; fi
    sleep 2
  done
  return 1
}
if ! run_id=$(find_run); then
  # A fork may have workflows disabled, or a retry may have no new push event.
  gh workflow enable linux.yml --repo AbdulRehman56/tinyhand
  gh workflow run linux.yml --repo AbdulRehman56/tinyhand --ref linux-port
  if ! run_id=$(find_run); then
    printf 'No release workflow run found. Check https://github.com/AbdulRehman56/tinyhand/actions and enable Actions if needed, then rerun this script.\n' >&2
    exit 1
  fi
fi
gh run watch "$run_id" --repo AbdulRehman56/tinyhand --exit-status
release_tag="v$(python3 -c 'import json; print(json.load(open("linux/companion/tinyhand@abdulrehmankhan56/metadata.json"))["version-name"])')"
gh release view "$release_tag" --repo AbdulRehman56/tinyhand --json url --jq .url
printf 'GNOME listing still needs a maintainer upload of the extension ZIP.\n'
