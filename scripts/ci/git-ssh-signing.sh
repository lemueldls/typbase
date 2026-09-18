#!/usr/bin/env bash
# Configures git to sign commits and tags with the SSH key in SSH_SIGNING_KEY.
# Leaves signing off when the key is missing.
set -euo pipefail

if [[ -z "${SSH_SIGNING_KEY:-}" ]]; then
    echo "SSH_SIGNING_KEY is not set; commits and tags stay unsigned."
    exit 0
fi

mkdir -p "$HOME/.ssh"
printf '%s\n' "$SSH_SIGNING_KEY" > "$HOME/.ssh/id_ed25519"
chmod 600 "$HOME/.ssh/id_ed25519"

git config --global gpg.format ssh
git config --global user.signingKey "$HOME/.ssh/id_ed25519"
git config --global user.name "${GIT_AUTHOR_NAME:-Lemuel DLS}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-noreply@git.lemueldls.dev}"
