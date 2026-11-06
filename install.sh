#!/usr/bin/env bash
# Installs NeoWallpaperLive for the current user. The extension and the CLI need
# no root; the packages they depend on (mpv, the hardware-decoding driver for
# your graphics card, ...) are installed with sudo, and only after asking.
#   ./install.sh                 install / update; offers to install missing packages
#   ./install.sh --video FILE    install and start playing FILE
#   ./install.sh --yes           install missing packages without asking
#   ./install.sh --no-deps       never touch packages
#   ./install.sh --dev           also install the tools the test suite needs
#   ./install.sh --force         skip the GNOME 50 / Wayland checks
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="neowallpaperlive@local"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$DATA_HOME/applications"

FORCE=0; VIDEO=""; ASSUME_YES=0; NO_DEPS=0; WITH_DEV=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=1 ;;
        --video) VIDEO=${2:-}; shift ;;
        -y|--yes) ASSUME_YES=1 ;;
        --no-deps) NO_DEPS=1 ;;
        --dev) WITH_DEV=1 ;;
        -h|--help) sed -n '2,/^set /p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- packages ---------------------------------------------------------------
# shellcheck source=install-deps.sh
source "$SRC_DIR/install-deps.sh"
if [[ $NO_DEPS -eq 0 ]]; then
    install_deps "$ASSUME_YES" "$WITH_DEV"
fi

# ---- requirements -----------------------------------------------------------
info "Checking requirements"
missing=()
command -v gnome-shell >/dev/null || missing+=("gnome-shell")
command -v gnome-extensions >/dev/null || missing+=("gnome-extensions (package: gnome-shell)")
command -v mpv >/dev/null || missing+=("mpv (sudo apt install mpv)")
command -v glib-compile-schemas >/dev/null || missing+=("glib-compile-schemas (sudo apt install libglib2.0-bin)")
command -v python3 >/dev/null || missing+=("python3")
if [[ ${#missing[@]} -gt 0 ]]; then
    printf '  missing: %s\n' "${missing[@]}" >&2
    die "install the missing tools and re-run"
fi

shell_version=$(gnome-shell --version | awk '{print $3}')
shell_major=${shell_version%%.*}
if [[ "$shell_major" != "50" ]]; then
    if [[ $FORCE -eq 1 ]]; then
        warn "GNOME Shell $shell_version is not 50.x; continuing because of --force"
    else
        die "GNOME Shell $shell_version found; this extension targets GNOME 50 (use --force to try anyway)"
    fi
fi
if [[ "${XDG_SESSION_TYPE:-}" != "wayland" ]]; then
    if [[ $FORCE -eq 1 ]]; then
        warn "session type is '${XDG_SESSION_TYPE:-unknown}', not wayland; continuing because of --force"
    else
        die "this extension needs a Wayland session (XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unknown})"
    fi
fi
echo "  gnome-shell $shell_version, wayland, mpv $(mpv --version | head -1 | awk '{print $2}')"

# ---- extension --------------------------------------------------------------
info "Installing extension to $EXT_DIR"
mkdir -p "$(dirname "$EXT_DIR")"
rm -rf "$EXT_DIR"
cp -r "$SRC_DIR/extension/$UUID" "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"

# ---- desktop entry (gives the renderer window a proper, hidden identity) --
info "Installing desktop entry"
mkdir -p "$APPS_DIR"
cp "$SRC_DIR/data/neowallpaperlive-renderer.desktop" "$APPS_DIR/"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true

# ---- CLI --------------------------------------------------------------------
info "Installing CLI to $BIN_DIR/neowallpaperlive"
mkdir -p "$BIN_DIR"
install -m 755 "$SRC_DIR/bin/neowallpaperlive" "$BIN_DIR/neowallpaperlive"
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR is not in your PATH; add it or call $BIN_DIR/neowallpaperlive" ;;
esac

# ---- enable -----------------------------------------------------------------
info "Enabling extension"
if ! gnome-extensions enable "$UUID" 2>/dev/null; then
    # The running shell has not scanned the new directory yet: add the uuid to
    # the setting directly; it takes effect at the next login.
    python3 - "$UUID" <<'EOF'
import ast, subprocess, sys
uuid = sys.argv[1]
cur = ast.literal_eval(subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "enabled-extensions"]).decode().replace("@as ", ""))
if uuid not in cur:
    cur.append(uuid)
    subprocess.check_call(["gsettings", "set", "org.gnome.shell", "enabled-extensions", repr(cur)])
EOF
fi

state=$(gnome-extensions info "$UUID" 2>/dev/null | awk -F': *' '/^ *State:/{print $2}' || true)
echo
if [[ "$state" == "ACTIVE" ]]; then
    info "Extension is active."
    relogin=0
else
    info "Extension installed. GNOME Shell on Wayland only loads new extension code at login:"
    echo "    log out and log back in, then the wallpaper starts automatically."
    relogin=1
fi

if [[ -n "$VIDEO" ]]; then
    "$BIN_DIR/neowallpaperlive" set "$VIDEO"
else
    echo
    echo "Next:  neowallpaperlive set ~/Videos/your-video.mp4"
fi
[[ $relogin -eq 1 ]] && echo "       (the setting is remembered; it applies after you log back in)"
echo "Help:  neowallpaperlive help"
