#!/usr/bin/env bash
# Package handling for install.sh (sourced, never run on its own).
#
# It plans for a *fresh* Ubuntu desktop, not for the machine it happens to run
# on: the full list of packages is worked out from the hardware, every package is
# checked individually, and only what is really missing is installed. That way a
# new computer gets everything, and an old one is left alone.
#
# What is needed:
#   everywhere   mpv, libglib2.0-bin (schema compiler, gsettings, gdbus), python3
#   Intel GPU    intel-media-va-driver   VA-API decoder, Broadwell and newer
#   AMD GPU      Mesa's VA-API driver    mesa-va-drivers on older Ubuntu, inside
#                                        libgl1-mesa-dri on newer ones
#   NVIDIA GPU   the proprietary driver  NOT installed here: large, a kernel
#                                        module, and Secure Boot needs a password
#   any VA-API   vainfo                  small; lets us confirm decoding works
#
# Nothing is installed without asking: in a terminal the list is shown first and
# sudo is only used on a yes; with --yes it goes ahead; with no terminal and no
# --yes the exact command is printed instead.

# Overridable so tests can describe any machine without owning one.
NWL_DRM_ROOT="${NWL_DRM_ROOT:-/sys/class/drm}"

# GPU vendors present, one per line, from: intel amd nvidia other
gpu_vendors() {
    local f id seen=" "
    for f in "$NWL_DRM_ROOT"/card[0-9]*/device/vendor; do
        [[ -r "$f" ]] || continue
        case "$(<"$f")" in
            0x8086) id=intel ;;
            0x1002) id=amd ;;
            0x10de) id=nvidia ;;
            *)      id=other ;;
        esac
        if [[ "$seen" != *" $id "* ]]; then
            seen+="$id "
            echo "$id"
        fi
    done
}

pkg_installed() {
    [[ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null)" == installed ]]
}

# True if apt knows a version of the package for this release.
pkg_available() {
    apt-cache policy "$1" 2>/dev/null |
        awk '/Candidate:/ {c = $2} END {exit !(c != "" && c != "(none)")}'
}

# Every package this machine needs, as "package|why", whether installed or not.
# $1 = 1 adds the tools only the test suite uses.
wanted_packages() {
    local with_dev=${1:-0} vendor decode=0
    echo "mpv|plays the video"
    echo "libglib2.0-bin|compiles the settings schema; gsettings and gdbus for the CLI"
    echo "python3|used by the CLI and by this installer"
    for vendor in $(gpu_vendors); do
        case "$vendor" in
            intel)
                echo "intel-media-va-driver|hardware video decoding on Intel graphics (Broadwell and newer)"
                decode=1 ;;
            amd)
                if pkg_available mesa-va-drivers; then
                    echo "mesa-va-drivers|hardware video decoding on AMD graphics"
                else
                    echo "libgl1-mesa-dri|hardware video decoding on AMD graphics (Mesa)"
                fi
                decode=1 ;;
        esac
    done
    if [[ $decode -eq 1 ]]; then
        echo "vainfo|lets the installer confirm that hardware decoding works"
    fi
    if [[ $with_dev -eq 1 ]]; then
        echo "ffmpeg|builds the test video (tests only)"
        echo "gjs|runs the fill-maths unit tests and the image tools (tests only)"
        echo "bc|timing in the test harness (tests only)"
    fi
    return 0
}

# stdin: "package|why" lines. stdout: those whose package is not installed.
missing_packages() {
    local line
    while IFS= read -r line; do
        pkg_installed "${line%%|*}" || echo "$line"
    done
}

# Things the installer cannot do for you, said out loud.
gpu_notes() {
    local vendors
    vendors=" $(gpu_vendors | tr '\n' ' ')"
    if [[ "$vendors" == *" nvidia "* ]]; then
        if command -v nvidia-smi >/dev/null 2>&1; then
            echo "  NVIDIA: the proprietary driver is installed; mpv will decode with NVDEC."
        else
            echo "  NVIDIA: hardware decoding needs the proprietary driver, which this installer does not"
            echo "          install (kernel module; Secure Boot asks for a password). Do it yourself:"
            echo "              sudo ubuntu-drivers install"
        fi
    fi
    if [[ -n "$vendors" && "$vendors" != *" intel "* && "$vendors" != *" amd "* && "$vendors" != *" nvidia "* ]]; then
        echo "  GPU: none of Intel, AMD or NVIDIA found (a virtual machine?); video will be decoded on the CPU."
    fi
    if [[ -z "${vendors// /}" ]]; then
        echo "  GPU: could not tell which graphics card this is; no hardware-decoding package chosen."
    fi
    return 0
}

# Ask the VA-API stack whether it can really decode H.264 on this machine.
verify_hwdec() {
    local vendors out profiles
    vendors=" $(gpu_vendors | tr '\n' ' ')"
    [[ "$vendors" == *" intel "* || "$vendors" == *" amd "* ]] || return 0
    if ! command -v vainfo >/dev/null 2>&1; then
        echo "  cannot confirm hardware decoding here (vainfo is not installed)"
        return 0
    fi
    if out=$(vainfo 2>&1); then
        profiles=$(grep -c 'VAProfile' <<<"$out" || true)
        if grep -q 'VAProfileH264' <<<"$out"; then
            echo "  hardware decoding: VA-API works ($profiles profiles, H.264 included)"
        else
            warn "VA-API answers but offers no H.264 decoding; the wallpaper will use the CPU"
        fi
    else
        warn "vainfo failed, so hardware decoding is not available yet: $(head -1 <<<"$out")"
        echo "  (the wallpaper still plays, on the CPU; log out and in once, or run: vainfo)"
    fi
    return 0
}

# install_deps ASSUME_YES WITH_DEV
install_deps() {
    local assume_yes=${1:-0} with_dev=${2:-0} wanted missing_lines line ans
    local -a pkgs=()

    info "Checking packages"
    wanted=$(wanted_packages "$with_dev")

    if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg-query >/dev/null 2>&1; then
        warn "no apt on this system; make sure these are installed: $(cut -d'|' -f1 <<<"$wanted" | tr '\n' ' ')"
        gpu_notes
        return 0
    fi

    missing_lines=$(missing_packages <<<"$wanted")
    gpu_notes
    if [[ -z "$missing_lines" ]]; then
        echo "  every needed package is already installed"
        verify_hwdec
        return 0
    fi

    echo "  to install:"
    while IFS= read -r line; do
        pkgs+=("${line%%|*}")
        printf '    %-24s %s\n' "${line%%|*}" "${line#*|}"
    done <<<"$missing_lines"

    if [[ $assume_yes -eq 1 ]]; then
        :
    elif [[ -t 0 ]]; then
        read -r -p "  Install them now? This runs sudo apt-get. [Y/n] " ans
        if [[ -n "$ans" && ! "$ans" =~ ^[Yy] ]]; then
            echo "  skipped. Later: sudo apt-get install ${pkgs[*]}"
            return 0
        fi
    else
        echo "  not a terminal, so nothing was installed. Run: sudo apt-get install ${pkgs[*]}"
        echo "  (or run ./install.sh --yes)"
        return 0
    fi

    if sudo apt-get install -y "${pkgs[@]}"; then
        verify_hwdec
    else
        warn "apt-get failed. Try: sudo apt-get update && sudo apt-get install ${pkgs[*]}"
    fi
    return 0
}
