#!/bin/sh

set -eu

LANE_HOME="${LANE_HOME:-$HOME/.lane-cli}"
LANE_REPO_URL="${LANE_REPO_URL:-https://github.com/anvk/lane.git}"
LANE_BRANCH="${LANE_BRANCH:-main}"
LANE_SUBDIR="${LANE_SUBDIR:-cli}"

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

if [ -d "$LANE_HOME/.git" ]; then
  say "Updating existing lane checkout in $LANE_HOME"
  # This checkout is managed: it is moved to whatever the branch points at, the same way
  # self-update does. Only edits made by hand are a reason to stop.
  if [ -n "$(git -C "$LANE_HOME" status --porcelain --untracked-files=no)" ]; then
    say "Error: $LANE_HOME has uncommitted changes."
    say "Commit or discard them (git -C $LANE_HOME status), then rerun the installer."
    exit 1
  fi
  if ! git -C "$LANE_HOME" fetch --depth 1 origin "$LANE_BRANCH"; then
    say "Error: failed to fetch updates from $LANE_REPO_URL"
    exit 1
  fi
  if ! git -C "$LANE_HOME" checkout -q -B "$LANE_BRANCH" FETCH_HEAD; then
    say "Error: failed to move the checkout to '$LANE_BRANCH'."
    exit 1
  fi
elif [ -e "$LANE_HOME" ]; then
  say "Error: $LANE_HOME exists but is not a git repository."
  say "Move or remove it, then rerun installer."
  exit 1
else
  say "Cloning lane into $LANE_HOME"
  if ! git clone --depth 1 --branch "$LANE_BRANCH" "$LANE_REPO_URL" "$LANE_HOME"; then
    say "Error: failed to clone $LANE_REPO_URL"
    exit 1
  fi
fi

LANE_PROJECT_DIR="$LANE_HOME/$LANE_SUBDIR"
if [ ! -d "$LANE_PROJECT_DIR" ]; then
  say "Error: expected project directory $LANE_PROJECT_DIR was not found in the checkout."
  exit 1
fi

cd "$LANE_PROJECT_DIR"
say "Installing dependencies"
npm install

say "Building lane"
npm run build

say "Linking lane globally"
npm link

# Record where lane actually lives, so it can tell a managed install from a developer's
# own npm-linked checkout without depending on LANE_HOME being exported.
LANE_STATE_DIR="$HOME/.lane"
mkdir -p "$LANE_STATE_DIR"
printf '{\n  "installDir": "%s"\n}\n' "$LANE_PROJECT_DIR" > "$LANE_STATE_DIR/install.json"

say ""
say "Done. Verify with: lane --version"
say "Installed at: $LANE_PROJECT_DIR"
