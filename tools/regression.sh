#!/usr/bin/env bash
# Runs every headless scenario and checks the invariants each one exists to
# protect, then prints one PASS/FAIL line per check.
#
#   tools/regression.sh [scenario ...]        default: all of them
#
# Each scenario runs in its own throwaway headless GNOME Shell; your session is
# never touched. Takes roughly 100 s per scenario.
set -uo pipefail

T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="$T/out/regression"
SCENARIOS=("$@")
[[ ${#SCENARIOS[@]} -eq 0 ]] && SCENARIOS=(smoke soak autopause pin sleep switch geom)

rm -rf "$OUTDIR"; mkdir -p "$OUTDIR"

# The fill maths first, on its own: the harness cannot produce a fractional
# monitor scale or a client that draws its own shadows, so those inputs are
# only ever exercised here.
printf '\033[1;34m==>\033[0m fill maths\n'
gjs -m "$T/fit-test.js" || FIT_FAILED=1

for sc in "${SCENARIOS[@]}"; do
    printf '\033[1;34m==>\033[0m running %s\n' "$sc"
    bash "$T/headless-test.sh" "$sc" > "$OUTDIR/$sc.txt" 2>&1
    # Keep the shell log next to the table for the checks below.
    run_out=$(grep -o 'out=[^ ]*' "$OUTDIR/$sc.txt" | head -1 | cut -d= -f2)
    [[ -n "$run_out" && -f "$run_out/shell.log" ]] && cp "$run_out/shell.log" "$OUTDIR/$sc.log"
    # Per-sample status, for the invariants the table has no column for.
    if [[ -n "$run_out" ]]; then mkdir -p "$OUTDIR/$sc"; cp "$run_out"/*.json "$OUTDIR/$sc/" 2>/dev/null; fi
done

echo
python3 - "$OUTDIR" "${SCENARIOS[@]}" <<'PY'
import glob, json, os, re, sys

outdir, scenarios = sys.argv[1], sys.argv[2:]
COLS = "t step pos drop playing layers pid win ipc d0 d1".split()
# Harmless and unrelated to this extension: a GI annotation mismatch in
# NetworkManager's typelib that GNOME Shell itself trips over at startup.
LOG_ALLOW = ("NM.Object",)

results = []
def check(scenario, name, ok, detail=""):
    results.append((scenario, name, bool(ok), detail))

def rows(scenario):
    path = os.path.join(outdir, f"{scenario}.txt")
    if not os.path.exists(path):
        return []
    out = []
    for line in open(path):
        if not re.match(r"^\s*\d+\.\d\s", line):
            continue
        parts = line.split(None, 11)
        if len(parts) < 11:
            continue
        row = dict(zip(COLS, parts[:11]))
        row["note"] = parts[11].strip() if len(parts) > 11 else ""
        out.append(row)
    return out

def statuses(scenario):
    """Every per-sample status the run left behind, oldest first."""
    out = []
    for path in sorted(glob.glob(os.path.join(outdir, scenario, "*.json"))):
        try:
            out.append((os.path.basename(path)[:-5], json.load(open(path))))
        except (ValueError, OSError):
            pass
    return out

def uncovered(status):
    """Layers the video does not fill, as 'sample:monitor(edges)'.

    In cover and stretch the clone must reach every edge of its layer; a gap
    means the fill maths mislaid the video (this is what a mistaken shadow
    inset did: it shifted the video up and left by the window's position on
    screen, baring the right-hand and bottom edges).
    """
    if status.get("fillMode") == "contain" or not status.get("playing"):
        return []
    bad = []
    for entry in status.get("layerBoxes") or []:
        lx, ly, lw, lh = entry["layer"]
        if not entry["clone"]:
            continue
        cx, cy, cw, ch = entry["clone"]
        edges = "".join(name for name, slack in
                        (("L", -cx), ("T", -cy), ("R", cx + cw - lw), ("B", cy + ch - lh))
                        if slack < -1)
        if edges:
            bad.append(f'{entry["monitor"]}({edges})')
    return bad

def pause_flags(row):
    """ipc column is '<hwdec>/<extension-reported>/<directly-queried>'."""
    bits = row["ipc"].split("/")
    if len(bits) != 3:
        return None, None, None
    hw, ext, direct = bits
    return hw, ext.startswith("P"), direct.startswith("P")

for sc in scenarios:
    r = rows(sc)
    check(sc, "scenario produced samples", len(r) >= 5, f"{len(r)} rows")
    if not r:
        continue

    log = os.path.join(outdir, f"{sc}.log")
    bad = []
    if os.path.exists(log):
        for line in open(log, errors="replace"):
            if re.search(r"JS ERROR|CRITICAL", line) and not any(a in line for a in LOG_ALLOW):
                bad.append(line.strip())
    check(sc, "no JS errors or criticals", not bad, bad[0][:90] if bad else "")

    playing = [x for x in r if x["playing"] == "True"]
    check(sc, "hardware decoding in use whenever playing",
          all(pause_flags(x)[0] in ("vaapi", "err") for x in playing),
          ",".join(sorted({pause_flags(x)[0] for x in playing})))
    check(sc, "one video layer per monitor while playing",
          all(x["layers"] in ("2", "5") for x in playing),
          ",".join(sorted({x["layers"] for x in playing})))
    # T1: the extension's own IPC link must agree with a direct query.
    disagree = [x["step"] for x in r
                if pause_flags(x)[1] is not None and pause_flags(x)[1] != pause_flags(x)[2]]
    check(sc, "status pause matches mpv's real state (T1 ipc)", not disagree, ",".join(disagree))

    gaps = [f"{tag}:{b}" for tag, st in statuses(sc) for b in uncovered(st)]
    check(sc, "video fills every layer edge to edge", not gaps, ",".join(gaps[:3]))

    by_step = {x["step"]: x for x in r}

    if sc == "smoke":
        note = by_step.get("stealth", {}).get("note", "")
        check(sc, "renderer hidden from window lists and dock (T-stealth)",
              '"actors":0' in note and '"tab":0' in note and '"running":[]' in note, note[:70])
        check(sc, "exit stops playback", by_step.get("exit", {}).get("playing") == "False")
        check(sc, "start resumes playback", by_step.get("start", {}).get("playing") == "True")

    if sc == "soak":
        pos = [float(x["pos"]) for x in r if re.match(r"^[\d.]+$", x["pos"])]
        stuck = [i for i in range(1, len(pos)) if abs(pos[i] - pos[i - 1]) < 0.01]
        check(sc, "playback advances at every sample", not stuck, f"{len(stuck)} stalls")
        check(sc, "no dropped frames", all(x["drop"] == "0" for x in r),
              ",".join(sorted({x["drop"] for x in r})))

    if sc == "autopause":
        want_paused = ("b-max1", "p1", "cov-on", "a-fs")
        want_playing = ("s1", "cov-off", "b-kill", "a-unfs", "s2")
        for step in want_paused:
            check(sc, f"paused at '{step}' (T2)", pause_flags(by_step.get(step, {"ipc": "//"}))[1] is True)
        for step in want_playing:
            check(sc, f"playing at '{step}' (T2)", pause_flags(by_step.get(step, {"ipc": "//"}))[1] is False)

    if sc == "pin":
        off = [x["step"] for x in r if not x["win"].startswith("m0/") and not x["step"].startswith("force")]
        check(sc, "renderer stays on the largest monitor (T3)", not off, ",".join(off))
        # The pin must not reach for a restart when move_to_monitor works.
        check(sc, "pinning does not restart the renderer (T14)",
              len({x["pid"] for x in r}) == 1, ",".join(sorted({x["pid"] for x in r})))
        forced = [x for x in r if x["step"].startswith("force")]
        check(sc, "forcing it onto the small monitor really shrinks the buffer",
              all(x["win"].startswith("m1/1280x1024") for x in forced),
              ",".join(x["win"] for x in forced))

    if sc == "sleep":
        pids = {x["step"]: x["pid"] for x in r}
        check(sc, "suspend pauses the renderer (T4)",
              pause_flags(by_step.get("suspend", {"ipc": "//"}))[1] is True)
        check(sc, "resume restarts playback (T4)",
              pause_flags(by_step.get("resume", {"ipc": "//"}))[1] is False)
        check(sc, "a healthy renderer is not restarted on resume (T4)",
              pids.get("s1") == pids.get("w1"), f'{pids.get("s1")} -> {pids.get("w1")}')
        check(sc, "a hung renderer is detected and replaced (T4)",
              pids.get("h1") not in (None, "-") and pids.get("h1") != pids.get("s1"),
              f'{pids.get("s1")} -> {pids.get("h1")}')

    if sc == "geom":
        # The point of the scenario: the renderer really is inset from its
        # monitor on both axes, or the check above proves nothing.
        rects = [st["rendererRects"] for _, st in statuses(sc) if st.get("rendererRects")]
        docked = [f for f in (r["frame"] for r in rects) if f[0] > 0 and f[1] > 0]
        check(sc, "the dock strut really insets the renderer (geom)", docked,
              str(docked[0]) if docked else "never inset")

    if sc == "switch":
        pids = {x["pid"] for x in r}
        check(sc, "changing the video keeps the same process (T5)", len(pids) == 1, ",".join(sorted(pids)))
        bufs = [by_step.get(s, {}).get("win", "") for s in ("s1", "b1", "s2", "b2")]
        check(sc, "buffer follows the new video size (T5)",
              bufs[0].endswith("1280x720") and bufs[1].endswith("2560x1440") and
              bufs[2].endswith("1280x720") and bufs[3].endswith("2560x1440"), " ".join(bufs))

width = max(len(n) for _, n, _, _ in results)
failed = 0
current = None
for sc, name, ok, detail in results:
    if sc != current:
        print(f"\n\033[1m{sc}\033[0m")
        current = sc
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    failed += not ok
    print(f"  {mark}  {name.ljust(width)}  {detail}")

print(f"\n{len(results) - failed}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
PY
scenarios_ok=$?
exit $(( scenarios_ok || ${FIT_FAILED:-0} ))
