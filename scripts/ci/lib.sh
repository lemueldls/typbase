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
