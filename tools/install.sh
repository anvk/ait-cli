#!/bin/sh

set -eu

AIT_HOME="${AIT_HOME:-$HOME/.ait-cli}"
AIT_REPO_URL="${AIT_REPO_URL:-https://github.com/anvk/ait-cli.git}"
AIT_BRANCH="${AIT_BRANCH:-main}"

say() {
  printf "%s\n" "$1"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    say "Error: required command '$1' is not installed."
    exit 1
  fi
}

need_cmd git
need_cmd node
need_cmd npm

if [ -d "$AIT_HOME/.git" ]; then
  say "Updating existing AIT checkout in $AIT_HOME"
  if ! git -C "$AIT_HOME" fetch origin "$AIT_BRANCH"; then
    say "Error: failed to fetch updates from $AIT_REPO_URL"
    exit 1
  fi
  if ! git -C "$AIT_HOME" checkout "$AIT_BRANCH"; then
    say "Error: failed to checkout branch '$AIT_BRANCH'"
    exit 1
  fi
  if ! git -C "$AIT_HOME" pull --ff-only origin "$AIT_BRANCH"; then
    say "Error: failed to fast-forward existing checkout."
    say "Resolve local changes in $AIT_HOME and rerun installer."
    exit 1
  fi
elif [ -e "$AIT_HOME" ]; then
  say "Error: $AIT_HOME exists but is not a git repository."
  say "Move or remove it, then rerun installer."
  exit 1
else
  say "Cloning AIT into $AIT_HOME"
  if ! git clone --depth 1 --branch "$AIT_BRANCH" "$AIT_REPO_URL" "$AIT_HOME"; then
    say "Error: failed to clone $AIT_REPO_URL"
    exit 1
  fi
fi

cd "$AIT_HOME"
say "Installing dependencies"
npm install

say "Building AIT"
npm run build

say "Linking AIT globally"
npm link

say ""
say "Done. Verify with: ait --version"
say "Installed at: $AIT_HOME"
