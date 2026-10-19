#!/bin/sh

set -eu

LANES_HOME="${LANES_HOME:-$HOME/.lanes-cli}"
LANES_REPO_URL="${LANES_REPO_URL:-https://github.com/anvk/lanes.git}"
LANES_BRANCH="${LANES_BRANCH:-main}"
LANES_SUBDIR="${LANES_SUBDIR:-cli}"

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

if [ -d "$LANES_HOME/.git" ]; then
  say "Updating existing lanes checkout in $LANES_HOME"
  # This checkout is managed: it is moved to whatever the branch points at, the same way
  # self-update does. Only edits made by hand are a reason to stop.
  if [ -n "$(git -C "$LANES_HOME" status --porcelain --untracked-files=no)" ]; then
    say "Error: $LANES_HOME has uncommitted changes."
    say "Commit or discard them (git -C $LANES_HOME status), then rerun the installer."
    exit 1
  fi
  if ! git -C "$LANES_HOME" fetch --depth 1 origin "$LANES_BRANCH"; then
    say "Error: failed to fetch updates from $LANES_REPO_URL"
    exit 1
  fi
  if ! git -C "$LANES_HOME" checkout -q -B "$LANES_BRANCH" FETCH_HEAD; then
    say "Error: failed to move the checkout to '$LANES_BRANCH'."
    exit 1
  fi
elif [ -e "$LANES_HOME" ]; then
  say "Error: $LANES_HOME exists but is not a git repository."
  say "Move or remove it, then rerun installer."
  exit 1
else
  say "Cloning lanes into $LANES_HOME"
  if ! git clone --depth 1 --branch "$LANES_BRANCH" "$LANES_REPO_URL" "$LANES_HOME"; then
    say "Error: failed to clone $LANES_REPO_URL"
    exit 1
  fi
fi

LANES_PROJECT_DIR="$LANES_HOME/$LANES_SUBDIR"
if [ ! -d "$LANES_PROJECT_DIR" ]; then
  say "Error: expected project directory $LANES_PROJECT_DIR was not found in the checkout."
  exit 1
fi

cd "$LANES_PROJECT_DIR"
say "Installing dependencies"
npm install

say "Building lanes"
npm run build

say "Linking lanes globally"
npm link

# Record where lanes actually lives, so it can tell a managed install from a developer's
# own npm-linked checkout without depending on LANES_HOME being exported.
LANES_STATE_DIR="$HOME/.lanes"
mkdir -p "$LANES_STATE_DIR"
printf '{\n  "installDir": "%s"\n}\n' "$LANES_PROJECT_DIR" > "$LANES_STATE_DIR/install.json"

say ""
say "Done. Verify with: lanes --version"
say "Installed at: $LANES_PROJECT_DIR"
