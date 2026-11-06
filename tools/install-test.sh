#!/usr/bin/env bash
# Tests the package logic of install.sh (install-deps.sh) against machines that
# are described rather than owned: a fake /sys/class/drm, a fake dpkg database,
# and stub sudo / apt-get / vainfo that only record what they were asked to do.
# Nothing is installed and no sudo is ever run.
#
#   tools/install-test.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

PASS=0; FAIL=0
check() { # name, ok(0/1), detail
    if [[ $2 -eq 0 ]]; then PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"
    else FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s  %s\n' "$1" "${3:-}"; fi
}
has()  { grep -qF -- "$2" <<<"$1"; }          # has "$text" "needle"
lacks() { ! grep -qF -- "$2" <<<"$1"; }

# ---- stubs ------------------------------------------------------------------
STUBS="$ROOT/stubs"; mkdir -p "$STUBS"
cat >"$STUBS/dpkg-query" <<'EOF'
#!/usr/bin/env bash
pkg=${@: -1}
grep -qx -- "$pkg" "$FAKE_INSTALLED" 2>/dev/null && { echo installed; exit 0; }
exit 1
EOF
cat >"$STUBS/apt-cache" <<'EOF'
#!/usr/bin/env bash
pkg=${@: -1}
if grep -qx -- "$pkg" "$FAKE_AVAILABLE" 2>/dev/null; then echo "  Candidate: 1.0"; else echo "  Candidate: (none)"; fi
EOF
cat >"$STUBS/apt-get" <<'EOF'
#!/usr/bin/env bash
echo "apt-get $*" >>"$FAKE_LOG"; exit "${FAKE_APT_RC:-0}"
EOF
cat >"$STUBS/sudo" <<'EOF'
#!/usr/bin/env bash
echo "sudo" >>"$FAKE_LOG"; exec "$@"
EOF
cat >"$STUBS/vainfo" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_VAINFO:-ok}" == ok ]]; then
    printf 'vainfo: VA-API version: 1.23\n      VAProfileH264Main : VAEntrypointVLD\n      VAProfileHEVCMain : VAEntrypointVLD\n'
else
    echo "libva error: vaGetDriverNames() failed with unknown libva error"; exit 1
fi
EOF
chmod +x "$STUBS"/*
# A PATH that has the stubs and the basic tools, but no apt-get at all.
NOAPT="$ROOT/noapt"; mkdir -p "$NOAPT"
for t in awk cut tr grep head sed cat sort; do ln -s "$(command -v $t)" "$NOAPT/$t"; done
for t in dpkg-query apt-cache; do ln -s "$STUBS/$t" "$NOAPT/$t"; done

# ---- one machine --------------------------------------------------------------
# machine NAME "vendor ids..." "installed pkgs..." "apt-available pkgs..."
machine() {
    M="$ROOT/$1"; mkdir -p "$M/drm"
    local i=0 v
    for v in $2; do
        mkdir -p "$M/drm/card$i/device"; echo "$v" >"$M/drm/card$i/device/vendor"; i=$((i+1))
    done
    printf '%s\n' $3 >"$M/installed"
    printf '%s\n' $4 >"$M/available"
    : >"$M/log"
}

# run_deps [ASSUME_YES [WITH_DEV]]   -> output in $OUT, status in $RC, apt log in $LOG
run_deps() {
    OUT=$(
        export NWL_DRM_ROOT="$M/drm" FAKE_INSTALLED="$M/installed" FAKE_AVAILABLE="$M/available" FAKE_LOG="$M/log"
        export PATH="${USE_PATH:-$STUBS:$PATH}"
        # shellcheck source=../install-deps.sh
        source "$REPO/install-deps.sh"
        info() { echo "==> $*"; }; warn() { echo "warning: $*"; }
        install_deps "${1:-0}" "${2:-0}" </dev/null
    ); RC=$?
    LOG=$(cat "$M/log")
}

printf '\033[1;34m==>\033[0m install.sh packages, on machines that are only described\n'

# 1. A brand-new Intel laptop, nothing installed, no terminal.
machine intel-fresh "0x8086" "" ""
run_deps
check "fresh Intel: needs mpv, the schema tool, python3, the Intel VA driver and vainfo" \
    $(has "$OUT" "mpv " && has "$OUT" "libglib2.0-bin" && has "$OUT" "python3" && has "$OUT" "intel-media-va-driver" && has "$OUT" "vainfo"; echo $?) "$OUT"
check "without a terminal and without --yes nothing is installed, and the command is shown" \
    $(has "$OUT" "not a terminal" && has "$OUT" "sudo apt-get install mpv libglib2.0-bin python3 intel-media-va-driver vainfo" && [[ -z "$LOG" ]]; echo $?) "$OUT | $LOG"

# 2. Same machine, --yes: one apt-get with exactly those packages, then it checks decoding.
machine intel-yes "0x8086" "" ""
run_deps 1
check "--yes: one sudo apt-get with exactly the missing packages" \
    $([[ "$LOG" == $'sudo\napt-get install -y mpv libglib2.0-bin python3 intel-media-va-driver vainfo' ]]; echo $?) "$LOG"
check "afterwards it reports that hardware decoding works" $(has "$OUT" "VA-API works"; echo $?) "$OUT"

# 3. VA-API installed but not working (e.g. needs a new login).
machine intel-broken "0x8086" "" ""
( FAKE_VAINFO=bad run_deps 1; echo "$OUT" >"$M/out"; echo "$RC" >"$M/rc" ) ; OUT=$(cat "$M/out"); RC=$(cat "$M/rc")
check "a failing vainfo is a warning, not a failed install" $(has "$OUT" "hardware decoding is not available yet" && [[ $RC -eq 0 ]]; echo $?) "$OUT"

# 4./5. AMD, both package layouts.
machine amd-old "0x1002" "" "mesa-va-drivers"
run_deps 1
check "AMD where mesa-va-drivers exists: that package, not libgl1-mesa-dri" \
    $(has "$LOG" "mesa-va-drivers" && lacks "$LOG" "libgl1-mesa-dri"; echo $?) "$LOG"
machine amd-new "0x1002" "" ""
run_deps 1
check "AMD where Mesa's VA-API lives in libgl1-mesa-dri: that package" \
    $(has "$LOG" "libgl1-mesa-dri" && lacks "$LOG" "mesa-va-drivers"; echo $?) "$LOG"
machine amd-new-ok "0x1002" "libgl1-mesa-dri" ""
run_deps 1
check "AMD with Mesa already present: it is not reinstalled" $(lacks "$LOG" "libgl1-mesa-dri"; echo $?) "$LOG"

# 6. NVIDIA only: base packages, no VA-API, and honest advice.
machine nvidia "0x10de" "" ""
run_deps 1
check "NVIDIA: no VA-API package and no vainfo" $(lacks "$LOG" "va-driver" && lacks "$LOG" "vainfo" && lacks "$LOG" "mesa"; echo $?) "$LOG"
check "NVIDIA without the driver: tells the user how, and does not install it" \
    $(has "$OUT" "sudo ubuntu-drivers install" && lacks "$LOG" "nvidia"; echo $?) "$OUT | $LOG"
machine nvidia-ok "0x10de" "" ""
cp "$STUBS/vainfo" "$STUBS/nvidia-smi"
run_deps 1
rm -f "$STUBS/nvidia-smi"
check "NVIDIA with the driver present: says NVDEC will be used" $(has "$OUT" "NVDEC"; echo $?) "$OUT"

# 7. Hybrid laptop: both vendors' needs, once each.
machine hybrid "0x8086 0x10de" "" ""
run_deps 1
check "Intel + NVIDIA: the Intel driver is installed, the NVIDIA note is shown" \
    $(has "$LOG" "intel-media-va-driver" && has "$OUT" "ubuntu-drivers install"; echo $?) "$LOG"
machine two-intel "0x8086 0x8086" "" ""
run_deps 1
check "two cards from one vendor do not repeat the package" \
    $([[ "$(grep -o intel-media-va-driver <<<"$LOG" | wc -l)" -eq 1 ]]; echo $?) "$LOG"

# 8. Virtual machine and unknown hardware.
machine vm "0x1af4" "" ""
run_deps 1
check "virtual GPU: base packages only, and it says decoding falls back to the CPU" \
    $(has "$LOG" "mpv" && lacks "$LOG" "va-driver" && has "$OUT" "virtual machine"; echo $?) "$OUT"
machine nogpu "" "" ""
run_deps 1
check "no GPU readable: still installs the base packages and says it could not tell" \
    $(has "$LOG" "mpv" && has "$OUT" "could not tell"; echo $?) "$OUT"

# 9. Already complete, and partly complete.
machine complete "0x8086" "mpv libglib2.0-bin python3 intel-media-va-driver vainfo" ""
run_deps 1
check "everything present: no apt-get, no sudo, and decoding is still verified" \
    $([[ -z "$LOG" ]] && has "$OUT" "already installed" && has "$OUT" "VA-API works"; echo $?) "$OUT | $LOG"
machine partial "0x8086" "mpv python3" ""
run_deps 1
check "partly installed: only the missing ones are requested" \
    $([[ "$LOG" == $'sudo\napt-get install -y libglib2.0-bin intel-media-va-driver vainfo' ]]; echo $?) "$LOG"

# 10. --dev adds the test tools, but only then.
machine dev "0x8086" "mpv libglib2.0-bin python3 intel-media-va-driver vainfo" ""
run_deps 1 0
check "without --dev the test tools are not asked for" $([[ -z "$LOG" ]]; echo $?) "$LOG"
run_deps 1 1
check "with --dev: ffmpeg, gjs and bc are added" $(has "$LOG" "ffmpeg gjs bc"; echo $?) "$LOG"

# 11. Failure and absence.
machine aptfail "0x8086" "" ""
( export FAKE_APT_RC=100; run_deps 1; echo "$OUT" >"$M/out"; echo "$RC" >"$M/rc" ); OUT=$(cat "$M/out"); RC=$(cat "$M/rc")
check "a failing apt-get warns, suggests apt-get update, and does not abort the installer" \
    $(has "$OUT" "apt-get failed" && has "$OUT" "apt-get update" && [[ $RC -eq 0 ]]; echo $?) "$OUT"
machine noapt "0x8086" "" ""
USE_PATH="$NOAPT" run_deps 1
check "no apt on the system: the package list is printed for the user instead" \
    $(has "$OUT" "no apt on this system" && has "$OUT" "intel-media-va-driver" && [[ -z "$LOG" ]]; echo $?) "$OUT"

# 12. The interactive question, through a real terminal.
ask() { # machine name, answer
    machine "$1" "0x8086" "" ""
    python3 - "$REPO" "$M" "$2" "$STUBS" <<'PY'
import os, pty, subprocess, sys, time
repo, m, answer, stubs = sys.argv[1:5]
script = f'''
export NWL_DRM_ROOT="{m}/drm" FAKE_INSTALLED="{m}/installed" FAKE_AVAILABLE="{m}/available" FAKE_LOG="{m}/log" PATH="{stubs}:$PATH"
source "{repo}/install-deps.sh"; info() {{ echo "==> $*"; }}; warn() {{ echo "warning: $*"; }}
install_deps 0 0
'''
master, slave = pty.openpty()
p = subprocess.Popen(["bash", "-c", script], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
time.sleep(1.0)
os.write(master, (answer + "\n").encode())
p.wait(timeout=20)
PY
    LOG=$(cat "$M/log")
}
ask tty-no "n"
check "answering n in a terminal installs nothing" $([[ -z "$LOG" ]]; echo $?) "$LOG"
ask tty-enter ""
check "just pressing Enter means yes" $(has "$LOG" "apt-get install -y mpv"; echo $?) "$LOG"

echo
printf '%d/%d checks passed\n' "$PASS" "$((PASS+FAIL))"
[[ $FAIL -eq 0 ]]
