#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/SagerNet/sing-box.git}"
PATCH_FILE="${PATCH_FILE:-$SCRIPT_DIR/patches/0001-clash-api-websocket-disconnect-subscription.patch}"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/dist}"
CACHE_DIR="${CACHE_DIR:-$SCRIPT_DIR/.cache/sing-box}"

for command in git go grep sed; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "error: required command not found: $command" >&2
    exit 1
  fi
done

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "error: patch not found: $PATCH_FILE" >&2
  exit 1
fi

if [[ -e "$CACHE_DIR" && ! -d "$CACHE_DIR/.git" ]]; then
  echo "error: cache path exists but is not a Git checkout: $CACHE_DIR" >&2
  exit 1
fi

if [[ ! -d "$CACHE_DIR/.git" ]]; then
  echo "Cloning $UPSTREAM_URL into persistent cache $CACHE_DIR"
  mkdir -p "$(dirname "$CACHE_DIR")"
  git clone --filter=blob:none --no-single-branch "$UPSTREAM_URL" "$CACHE_DIR"
else
  echo "Updating cached checkout $CACHE_DIR"
fi

cd "$CACHE_DIR"
git fetch --tags --prune origin

# Undo only the patch applied by the previous run. Refuse to overwrite any
# other tracked edits in the persistent checkout.
if git apply --check --reverse "$PATCH_FILE" >/dev/null 2>&1; then
  git apply --reverse "$PATCH_FILE"
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: cached checkout has unrelated tracked changes: $CACHE_DIR" >&2
  echo "Move or commit those changes, then run the build again." >&2
  exit 1
fi

if [[ -n "${SING_BOX_REF:-}" ]]; then
  VERSION_REF="$SING_BOX_REF"
else
  VERSION_REF="$(git tag --list 'v*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n '1p')"
fi

if [[ -z "$VERSION_REF" ]]; then
  echo "error: no stable sing-box release tag found" >&2
  exit 1
fi

echo "Checking out $VERSION_REF"
git checkout --detach "$VERSION_REF"

echo "Applying $(basename "$PATCH_FILE")"
git apply --check "$PATCH_FILE"
git apply "$PATCH_FILE"

HOST_GOOS="$(go env GOOS)"
HOST_GOARCH="$(go env GOARCH)"
TARGET_GOOS="${GOOS:-$HOST_GOOS}"
TARGET_GOARCH="${GOARCH:-$HOST_GOARCH}"

if [[ -n "${BUILD_TAGS:-}" ]]; then
  TAGS="$BUILD_TAGS"
elif [[ "$TARGET_GOOS" == "windows" ]]; then
  TAGS="$(<release/DEFAULT_BUILD_TAGS_WINDOWS)"
else
  TAGS="$(<release/DEFAULT_BUILD_TAGS_OTHERS)"
fi

BINARY_NAME="sing-box-${VERSION_REF#v}-${TARGET_GOOS}-${TARGET_GOARCH}"
if [[ "$TARGET_GOOS" == "windows" ]]; then
  BINARY_NAME="$BINARY_NAME.exe"
fi

mkdir -p "$OUTPUT_DIR"

echo "Testing patched Clash API"
GOTOOLCHAIN="${GOTOOLCHAIN:-auto}" go test ./experimental/clashapi

echo "Building $BINARY_NAME"
CGO_ENABLED="${CGO_ENABLED:-0}" \
GOOS="$TARGET_GOOS" \
GOARCH="$TARGET_GOARCH" \
GOTOOLCHAIN="${GOTOOLCHAIN:-auto}" \
go build \
  -trimpath \
  -tags "$TAGS" \
  -ldflags "-X github.com/sagernet/sing-box/constant.Version=${VERSION_REF#v} $(<release/LDFLAGS) -s -w -buildid=" \
  -o "$OUTPUT_DIR/$BINARY_NAME" \
  ./cmd/sing-box

echo "Built $OUTPUT_DIR/$BINARY_NAME"
