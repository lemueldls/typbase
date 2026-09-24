#!/usr/bin/env bash
# Writes the AUR deploy key into the build user's ~/.ssh. Skips when the key is
# missing. Run as root, before aur-publish.sh switches to the build user.
set -euo pipefail

if [[ -z "${AUR_DEPLOY_KEY:-}" ]]; then
    echo "AUR_DEPLOY_KEY is not set; skipping the push."
    exit 0
fi

build_user=${BUILD_USER:-builder}
home=$(getent passwd "$build_user" | cut -d: -f6)
[[ -n "$home" ]] || {
    echo "User $build_user does not exist" >&2
    exit 1
}

mkdir -p "$home/.ssh"
printf '%s\n' "$AUR_DEPLOY_KEY" > "$home/.ssh/aur"
chmod 600 "$home/.ssh/aur"
cat > "$home/.ssh/config" <<'EOF'
Host aur.archlinux.org
  IdentityFile ~/.ssh/aur
  User aur
  StrictHostKeyChecking accept-new
EOF
chown -R "$build_user:$build_user" "$home/.ssh"
