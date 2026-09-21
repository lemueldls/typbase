#!/usr/bin/env bash
# Helpers for the scripts in this directory. Source this file, do not run it.

# Fails with a message on stderr.
die() {
    echo "$*" >&2
    exit 1
}

# Fails unless the named variable is set and non-empty.
require() {
    local name=$1
    if [[ -z "${!name:-}" ]]; then
        die "$name is not set"
    fi
}

# Writes a GitHub Actions step output. Falls back to stdout so the same script
# can run outside a workflow.
set_output() {
    local key=$1 value=$2
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "$key=$value" >> "$GITHUB_OUTPUT"
    else
        echo "$key=$value"
    fi
}

# Runs git-cliff from PATH (CI jobs install it with install-git-cliff.sh) or
# from the workspace devDependency.
git_cliff() {
    if command -v git-cliff >/dev/null 2>&1; then
        git-cliff "$@"
    elif [[ -x ./node_modules/.bin/git-cliff ]]; then
        ./node_modules/.bin/git-cliff "$@"
    else
        die "git-cliff is not installed; run pnpm install or scripts/ci/install-git-cliff.sh"
    fi
}
