"""DR2 stage cycler: drive DiRT Rally 2.0 through Time Trial for every stage in the suggestion list, and name
each one from the telemetry Bin It sees. It doubles as a smoke test: every stage must load, send telemetry, and
report the length its list entry says.

Needs `tauri dev` running (the dev API is only in a debug build) and DR2 sending UDP to Bin It, in windowed or
borderless mode, sitting in the main menu. No third-party packages: keys and clicks go in with Win32 SendInput.

    python cycle.py --set-click               record where the mouse is as the Time Trial click, nothing else
    python cycle.py --list                    print the plan, press nothing
    python cycle.py --only "El Rodeo"         one stage (substring of "<country> <stage>")
    python cycle.py --limit 3                 the first 3 that aren't done yet
    python cycle.py                           everything not done yet

Hold F10 at any time to stop. The key presses and waits live in config.json (`steps`), so a menu that behaves
differently is a config edit, not a code change. Results are kept in results.json and a finished stage is skipped
next time.
"""

import argparse
import ctypes
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
NAMES = REPO / "app" / "src" / "data" / "dr2-names.json"
CONFIG = HERE / "config.json"
RESULTS = HERE / "results.json"
LENGTH_TOLERANCE_KM = 0.15  # default slack between the list's km and the telemetry's length; config "length_tolerance_km" overrides it
ABORT_VK = 0x79  # F10

DEFAULT_CONFIG = {
    "api": "http://127.0.0.1:7878",
    "window_title": "DiRT Rally 2.0",
    # Where to click (physical screen pixels) to open Time Trial from the main menu.
    "time_trial_click": [0, 0],
    # In-game order of the locations, as the list's country names. Empty = the list's own order, which is
    # probably NOT the game's: check it against the menu before a full run.
    "location_order": [],
    # Per location, its stages in the order the game's menu shows them: {"Argentina": ["El Rodeo", ...]}.
    # Any stage left out goes at the end. `--write-order` fills this in from the list for you to reorder.
    "stage_order": {},
    "capture_timeout_s": 60,
    "stop_after_failures": 2,
    # What to press for each stage. {loc} and {stage} are the arrow presses to reach the location / the stage.
    "steps": [
        {"click": "time_trial"},
        {"wait": 1.5},
        {"key": "right", "times": "{loc}"},
        {"key": "enter"},
        {"wait": 1.0},
        {"key": "right", "times": "{stage}"},
        {"key": "enter"},
        {"key": "down", "times": 2},
        {"key": "enter"},
        {"wait": 10},
        {"key": "enter"},
        {"key": "enter"},
        {"wait": 12},
        {"hold": "space", "seconds": 3},
        {"capture": True},
        {"key": "escape"},
        {"wait": 1.0},
        {"key": "down", "times": 3},
        {"key": "enter"},
        {"wait": 1.0},
        {"key": "left"},
        {"key": "enter"},
        {"wait": 6},
    ],
}

# ---- Win32 input ---------------------------------------------------------------

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
user32 = ctypes.windll.user32

# Scan codes, not virtual keys: games read the hardware code. (code, extended)
KEYS = {
    "enter": (0x1C, False), "escape": (0x01, False), "space": (0x39, False),
    "up": (0x48, True), "down": (0x50, True), "left": (0x4B, True), "right": (0x4D, True),
    "tab": (0x0F, False), "backspace": (0x0E, False),
}
# Letters, so a step can hold "a" or "w" (QWERTY scan codes).
for _row, _codes in (("qwertyuiop", 0x10), ("asdfghjkl", 0x1E), ("zxcvbnm", 0x2C)):
    for _i, _letter in enumerate(_row):
        KEYS[_letter] = (_codes + _i, False)
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x1, 0x2, 0x8


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_void_p)]


class INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


def send_key(name, up):
    scan, ext = KEYS[name]
    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_EXTENDEDKEY if ext else 0) | (KEYEVENTF_KEYUP if up else 0)
    event = INPUT(type=1, ki=KEYBDINPUT(0, scan, flags, 0, None))
    user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(INPUT))


def press(name, hold=0.08):
    send_key(name, False)
    time.sleep(hold)
    send_key(name, True)
    time.sleep(0.15)


def click(x, y):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.15)
    user32.mouse_event(0x2, 0, 0, 0, 0)  # left down
    time.sleep(0.06)
    user32.mouse_event(0x4, 0, 0, 0, 0)  # left up
    time.sleep(0.15)


def cursor_position():
    point = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(point))
    return point.x, point.y


def foreground_title():
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(user32.GetForegroundWindow(), buf, 256)
    return buf.value


class Abort(Exception):
    pass


def check_abort():
    if user32.GetAsyncKeyState(ABORT_VK) & 0x8000:
        raise Abort("F10 held")


LOG = HERE / "cycle.log"


def raw(text):
    """Appends one timestamped line to cycle.log, beside this file. Everything is kept; nothing is trimmed."""
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {text}\n")
    except OSError:
        pass


ESC = "\x1b"


class Live:
    """A few lines at the bottom of the terminal that are redrawn in place; `emit` prints a permanent line above them.
    Every redraw is one write with line wrapping switched off, so a long line can't push the block down.
    Without a terminal (output piped to a file) the lines are printed as they change instead."""
    LINES = 4  # 0 the stage, 1 the step, 2 the detail (a note, a countdown), 3 the last result
    NOWRAP, WRAP = ESC + "[?7l", ESC + "[?7h"

    def __init__(self):
        self.tty = sys.stdout.isatty()
        self.text = [""] * self.LINES
        self.drawn = False
        if self.tty:
            os.system("")  # turns on ANSI escape handling in the Windows console

    def _fit(self, text):
        return text[: max(20, shutil.get_terminal_size().columns - 2)]

    def _frame(self, above=None):
        """Moves to the top of the block, writes `above` as a permanent line if given, then the block, in one go."""
        out = self.NOWRAP + (f"{ESC}[{self.LINES}A" if self.drawn else "") + "\r"
        if above is not None:
            out += f"{ESC}[2K" + self._fit(above) + "\n"
        out += "".join(f"{ESC}[2K" + self._fit(t) + "\n" for t in self.text) + self.WRAP
        sys.stdout.write(out)
        sys.stdout.flush()
        self.drawn = True

    def set(self, line, text, log=True):
        if self.text[line] == text:
            return
        self.text[line] = text
        if log and text:
            raw(text)
        if self.tty:
            self._frame()
        elif log and line != 2:
            print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)

    def emit(self, text):
        raw(text)
        stamped = f"[{time.strftime('%H:%M:%S')}] {text}"
        if self.tty:
            self._frame(stamped)
        else:
            print(stamped, flush=True)

    def done(self):
        if self.tty and self.drawn:
            sys.stdout.write(self.NOWRAP + f"{ESC}[{self.LINES}A\r" + f"{ESC}[2K\n" * self.LINES + f"{ESC}[{self.LINES}A" + self.WRAP)
            sys.stdout.flush()
        self.drawn = False
        self.text = [""] * self.LINES


LIVE = Live()


def wait(seconds, what="waiting"):
    end = time.time() + seconds
    while time.time() < end:
        check_abort()
        LIVE.set(2, f"{what}: {max(0.0, end - time.time()):.1f}s", log=False)
        time.sleep(0.1)

# ---- Bin It dev API -------------------------------------------------------------


def api(cfg, method, path, body=None):
    req = urllib.request.Request(
        cfg["api"] + "/api" + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={} if body is None else {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read() or "null")


def seen_now(cfg):
    """The stage and car the game is reporting right now, or None."""
    return (api(cfg, "GET", "/dev/associations/dr2").get("now") or {}).get("identity")

# ---- plan -----------------------------------------------------------------------


def build_plan(cfg):
    stages = json.loads(NAMES.read_text(encoding="utf-8"))["stages"]
    by_country = {}
    for s in stages:
        by_country.setdefault(s["country"], []).append(s)
    order = list(cfg["location_order"]) or list(by_country)
    order += [c for c in by_country if c not in order]
    plan = []
    for loc, country in enumerate(order):
        listed = by_country.get(country, [])
        wanted = cfg.get("stage_order", {}).get(country, [])
        known = {s["stage"] for s in listed}
        unknown = [n for n in wanted if n not in known]
        if unknown:
            sys.exit(f"stage_order for {country} names stages that aren't in the list: {unknown}")
        ranked = sorted(listed, key=lambda s: wanted.index(s["stage"]) if s["stage"] in wanted else len(wanted))
        for idx, s in enumerate(ranked):
            plan.append({"name": f"{country} {s['stage']}", "country": country, "stage_name": s["stage"],
                         "km": s["km"], "loc": loc, "stage": idx})
    return plan


def write_order(cfg):
    """Put the current location and stage order into the config, to be reordered by hand to match the menu."""
    locations, stages = [], {}
    for p in build_plan(cfg):
        if p["country"] not in locations:
            locations.append(p["country"])
        stages.setdefault(p["country"], []).append(p["stage_name"])
    on_disk = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else dict(DEFAULT_CONFIG)
    on_disk["location_order"], on_disk["stage_order"] = locations, stages
    CONFIG.write_text(json.dumps(on_disk, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote location_order and stage_order to {CONFIG.name}: reorder them to match the game's menus.")


def load_results():
    try:
        return json.loads(RESULTS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_results(results):
    RESULTS.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

# ---- one stage ------------------------------------------------------------------


def capture(cfg, item, previous_id):
    """Wait for a stage the game wasn't reporting before, check it, name it. Returns (status, detail)."""
    deadline = time.time() + cfg["capture_timeout_s"]
    while time.time() < deadline:
        check_abort()
        LIVE.set(2, f"waiting for the game's telemetry to show a new stage: {max(0, deadline - time.time()):.0f}s left", log=False)
        try:
            ident = seen_now(cfg)
        except (urllib.error.URLError, OSError) as e:
            return "api-error", {"error": str(e)}
        stage = ident and ident["stage"]
        if stage and stage.get("id") and stage.get("start") and stage["id"] != previous_id:
            km = stage["length_m"] / 1000
            detail = {"id": stage["id"], "measured_km": round(km, 3), "car": ident["car"]["id"]}
            if abs(km - item["km"]) > cfg.get("length_tolerance_km", LENGTH_TOLERANCE_KM):
                return "length-mismatch", detail
            api(cfg, "PUT", "/dev/associations/dr2/stage",
                {"name": item["name"], "detail": {"length_m": stage["length_m"], "start": stage["start"]}})
            return "ok", detail
        time.sleep(0.5)
    return "no-telemetry", {}


def resolve_times(step, item):
    times = step.get("times", 1)
    return int(item[times.strip("{}")] if isinstance(times, str) else times)


def describe(step, cfg, item):
    """What a step is about to do, in words, for the log. A step may also carry a `wait` after its action."""
    if "click" in step:
        what = f"click at {tuple(cfg['time_trial_click'])}"
    elif "key" in step:
        what = f"press {step['key'].upper()} x{resolve_times(step, item)}"
    elif "hold" in step:
        what = f"hold {step['hold'].upper()} for {step['seconds']}s, then release"
    elif step.get("capture"):
        what = f"read the stage from Bin It (up to {cfg['capture_timeout_s']}s)"
    elif "wait" in step:
        return f"wait {step['wait']}s"
    else:
        return f"UNKNOWN STEP {step}"
    return f"{what}, then wait {step['wait']}s" if "wait" in step else what


def log(text):
    print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)


def run_steps(cfg, item, previous_id):
    outcome = ("no-telemetry", {})
    steps = cfg["steps"]
    for n, step in enumerate(steps, 1):
        check_abort()
        title = foreground_title()
        if cfg["window_title"].lower() not in title.lower():
            raise Abort(f"the game isn't in front (front window: {title!r})")
        LIVE.set(1, f"step {n}/{len(steps)}: {step.get('note') or describe(step, cfg, item)}  ({describe(step, cfg, item)})")
        LIVE.set(2, "")
        if "click" in step:
            click(*cfg["time_trial_click"])
        elif "key" in step:
            for _ in range(resolve_times(step, item)):
                press(step["key"])
        elif "hold" in step:
            send_key(step["hold"], False)
            try:
                wait(step["seconds"])
            finally:
                send_key(step["hold"], True)
        elif step.get("capture"):
            outcome = capture(cfg, item, previous_id)
        if "wait" in step:
            wait(step["wait"], "waiting")
    return outcome

# ---- main -----------------------------------------------------------------------


def set_click(seconds=5):
    """Counts down, then stores wherever the mouse is as the Time Trial click. Nothing else in the config changes."""
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else dict(DEFAULT_CONFIG)
    print(f"Put the mouse over the Time Trial button in the game's main menu. Reading it in {seconds} s...")
    for left in range(seconds, 0, -1):
        print(f"  {left}...", flush=True)
        time.sleep(1)
    x, y = cursor_position()
    cfg["time_trial_click"] = [x, y]
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"time_trial_click set to [{x}, {y}] in {CONFIG.name}.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--set-click", action="store_true", help="save the mouse position as time_trial_click and exit")
    ap.add_argument("--write-order", action="store_true", help="copy the current location/stage order into the config to edit")
    ap.add_argument("--export", action="store_true",
                    help="write the names recorded in Bin It into the source (dr2/known.json) so a release ships them, then exit")
    ap.add_argument("--only")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--redo", action="store_true", help="also redo stages already marked ok")
    args = ap.parse_args()

    if args.set_click:
        set_click()
        return
    if args.export:
        cfg = {**DEFAULT_CONFIG, **(json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {})}
        print("Wrote:", ", ".join(api(cfg, "POST", "/dev/associations/dr2/export")["written"]))
        print("The dev app restarts when source changes, so do this once the cycler has finished. Review and commit the files.")
        return
    if args.write_order:
        write_order({**DEFAULT_CONFIG, **(json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {})})
        return
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
        print(f"Wrote {CONFIG.name} with defaults: set time_trial_click and location_order, then run again.")
        return
    cfg = {**DEFAULT_CONFIG, **json.loads(CONFIG.read_text(encoding="utf-8"))}
    plan = build_plan(cfg)
    results = load_results()
    todo = [p for p in plan
            if (not args.only or args.only.lower() in p["name"].lower())
            and (args.redo or results.get(p["name"], {}).get("status") != "ok")]
    if args.limit:
        todo = todo[: args.limit]

    if args.list:
        for p in todo:
            print(f"loc {p['loc']:>2}  stage {p['stage']:>2}  {p['km']:>5.1f} km  {p['name']}")
        print(f"{len(todo)} to do, {len(plan)} in the list")
        return

    print(f"{len(todo)} stage(s). Put the game in the main menu and click into it: starting in 8 s. Hold F10 to stop.")
    previous_id, failures = None, 0
    raw(f"---- run started: {len(todo)} stage(s), args: {' '.join(sys.argv[1:])}")
    try:
        LIVE.set(0, "Get ready: click into the game, it is about to start")
        wait(8, "starting in")
        for n, item in enumerate(todo, 1):
            LIVE.set(0, f"stage {n}/{len(todo)}: {item['country']} / {item['stage_name']}"
                        f"   (location {item['loc'] + 1}, stage {item['stage'] + 1} in its row, expected {item['km']} km)")
            status, detail = run_steps(cfg, item, previous_id)
            results[item["name"]] = {"status": status, **detail}
            save_results(results)
            raw(f"RESULT {item['name']}: {status} {json.dumps(detail, ensure_ascii=False)} (expected {item['km']} km)")
            shown = f"{n}/{len(todo)} {item['name']}: {status}" + (
                f" (measured {detail['measured_km']} km, expected {item['km']} km)" if "measured_km" in detail else f" (expected {item['km']} km)")
            LIVE.emit(shown)
            LIVE.set(3, f"last: {shown}")
            if status == "ok":
                previous_id, failures = detail["id"], 0
            else:
                failures += 1
                if failures >= cfg["stop_after_failures"]:
                    LIVE.done()
                    print(f"Stopping after {failures} failures in a row: the menu steps probably need adjusting.")
                    break
    except Abort as e:
        LIVE.done()
        raw(f"STOPPED: {e}")
        print(f"Stopped: {e}")
    finally:
        LIVE.done()
        send_key("space", True)
        ok = sum(1 for r in results.values() if r.get("status") == "ok")
        print(f"{ok}/{len(plan)} stages named and verified. Details in {RESULTS.name}.")


if __name__ == "__main__":
    sys.exit(main())
