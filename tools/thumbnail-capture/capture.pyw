"""Thumbnail Capture: save a fixed screen region to a consistent folder.

Pick a region once, then press F9 (works while a game has focus) or the
Capture button. Each shot is saved as <name>.png in the output folder.
No third-party packages: tkinter + Win32 GDI via ctypes.

Run: double-click capture.pyw, or `pythonw capture.pyw`.
"""

import ctypes
import json
import struct
import tkinter as tk
import zlib
from tkinter import ttk
from ctypes import wintypes
from pathlib import Path
from tkinter import filedialog

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
DEFAULT_OUT = HERE / "captures"
HOTKEY_VK = 0x78  # F9
REPO = HERE.parent.parent
DR2_DIR = REPO / "crates" / "tt-games" / "src" / "dr2"
DR2_NAMES = REPO / "app" / "src" / "data" / "dr2-names.json"  # the full car list

# Physical pixels everywhere, so the region matches what GDI captures.
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
H = ctypes.c_void_p  # handles are pointer-sized; default int conversion overflows on x64
user32.GetDC.restype = H
user32.GetDC.argtypes = [H]
user32.ReleaseDC.argtypes = [H, H]
gdi32.CreateCompatibleDC.restype = H
gdi32.CreateCompatibleDC.argtypes = [H]
gdi32.CreateCompatibleBitmap.restype = H
gdi32.CreateCompatibleBitmap.argtypes = [H, ctypes.c_int, ctypes.c_int]
gdi32.SelectObject.restype = H
gdi32.SelectObject.argtypes = [H, H]
gdi32.DeleteObject.argtypes = [H]
gdi32.DeleteDC.argtypes = [H]
gdi32.SetStretchBltMode.argtypes = [H, ctypes.c_int]
gdi32.SetBrushOrgEx.argtypes = [H, ctypes.c_int, ctypes.c_int, H]
gdi32.BitBlt.argtypes = [H, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                         H, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
gdi32.StretchBlt.argtypes = [H, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                             H, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                             wintypes.DWORD]
gdi32.GetDIBits.argtypes = [H, H, wintypes.UINT, wintypes.UINT, ctypes.c_void_p,
                            ctypes.c_void_p, wintypes.UINT]

SRCCOPY = 0x00CC0020
CAPTUREBLT = 0x40000000
HALFTONE = 4


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


def grab(x, y, w, h, out_w, out_h):
    """Copy a screen rectangle, scaled to out_w x out_h, as top-down BGRA bytes."""
    screen = user32.GetDC(None)
    mem = gdi32.CreateCompatibleDC(screen)
    bmp = gdi32.CreateCompatibleBitmap(screen, out_w, out_h)
    old = gdi32.SelectObject(mem, bmp)
    if (out_w, out_h) == (w, h):
        gdi32.BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY | CAPTUREBLT)
    else:
        gdi32.SetStretchBltMode(mem, HALFTONE)
        gdi32.SetBrushOrgEx(mem, 0, 0, None)
        gdi32.StretchBlt(mem, 0, 0, out_w, out_h, screen, x, y, w, h, SRCCOPY | CAPTUREBLT)
    info = BITMAPINFOHEADER()
    info.biSize = ctypes.sizeof(info)
    info.biWidth, info.biHeight = out_w, -out_h  # negative = top-down
    info.biPlanes, info.biBitCount = 1, 32
    buf = ctypes.create_string_buffer(out_w * out_h * 4)
    gdi32.GetDIBits(mem, bmp, 0, out_h, buf, ctypes.byref(info), 0)
    gdi32.SelectObject(mem, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(None, screen)
    return buf.raw


def write_png(path, bgra, w, h):
    rgb = bytearray(w * h * 3)
    rgb[0::3], rgb[1::3], rgb[2::3] = bgra[2::4], bgra[1::4], bgra[0::4]
    stride = w * 3
    raw = bytearray()
    for row in range(h):
        raw.append(0)
        raw += rgb[row * stride:(row + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def dr2_cars(extra):
    """Car names: the full DR2 name list, or the smaller catalogue files if it is missing, plus typed ones."""
    names = set(extra)
    try:
        names.update(json.loads(DR2_NAMES.read_text(encoding="utf-8")).get("cars", []))
        return sorted(names, key=str.lower)
    except Exception:
        pass
    for file in ("catalogue.json", "known.json"):
        try:
            data = json.loads((DR2_DIR / file).read_text(encoding="utf-8"))
            names.update(c["name"] for c in data.get("cars", []) if c.get("name"))
        except Exception:
            pass
    return sorted(names, key=str.lower)


def move_region(root, region):
    """Show the saved region on a dimmed screen; drag it to a new spot (size is kept).

    Enter or releasing the mouse confirms, Esc cancels. Returns the new (x, y, w, h) or None.
    """
    vx, vy = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
    vw, vh = user32.GetSystemMetrics(78), user32.GetSystemMetrics(79)
    top = tk.Toplevel(root)
    top.overrideredirect(True)
    top.geometry(f"{vw}x{vh}+{vx}+{vy}")
    top.attributes("-topmost", True, "-alpha", 0.3)
    top.configure(bg="black", cursor="fleur")
    canvas = tk.Canvas(top, bg="black", highlightthickness=0)
    canvas.pack(fill="both", expand=True)
    canvas.create_text(vw // 2, 40, fill="white", font=("Segoe UI", 16),
                       text="Drag to move the region  (Enter or release to confirm, Esc to cancel)")
    x, y, w, h = region
    pos = {"x": x, "y": y, "grab": None, "done": False}
    rect = canvas.create_rectangle(x - vx, y - vy, x - vx + w, y - vy + h,
                                   outline="#00e5ff", width=2)

    def place():
        canvas.coords(rect, pos["x"] - vx, pos["y"] - vy, pos["x"] - vx + w, pos["y"] - vy + h)

    def press(e):
        pos["grab"] = (e.x_root - pos["x"], e.y_root - pos["y"])

    def drag(e):
        if pos["grab"]:
            pos["x"], pos["y"] = e.x_root - pos["grab"][0], e.y_root - pos["grab"][1]
            place()

    def confirm(_=None):
        pos["done"] = True
        top.destroy()

    canvas.bind("<ButtonPress-1>", press)
    canvas.bind("<B1-Motion>", drag)
    canvas.bind("<ButtonRelease-1>", lambda e: confirm() if pos["grab"] else None)
    top.bind("<Return>", confirm)
    top.bind("<Escape>", lambda e: top.destroy())
    top.focus_force()
    root.wait_window(top)
    return (pos["x"], pos["y"], w, h) if pos["done"] else None


def pick_region(root):
    """Dim every monitor, let the user drag a rectangle. Returns (x, y, w, h) or None."""
    vx, vy = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
    vw, vh = user32.GetSystemMetrics(78), user32.GetSystemMetrics(79)
    top = tk.Toplevel(root)
    top.overrideredirect(True)
    top.geometry(f"{vw}x{vh}+{vx}+{vy}")
    top.attributes("-topmost", True, "-alpha", 0.3)
    top.configure(bg="black", cursor="crosshair")
    canvas = tk.Canvas(top, bg="black", highlightthickness=0)
    canvas.pack(fill="both", expand=True)
    canvas.create_text(vw // 2, 40, fill="white", font=("Segoe UI", 16),
                       text="Drag to select the capture region  (Esc to cancel)")
    state = {"start": None, "rect": None, "result": None}

    def press(e):
        state["start"] = (e.x_root, e.y_root)
        state["rect"] = canvas.create_rectangle(e.x, e.y, e.x, e.y, outline="#00e5ff", width=2)

    def drag(e):
        if state["start"]:
            sx, sy = state["start"]
            canvas.coords(state["rect"], sx - vx, sy - vy, e.x_root - vx, e.y_root - vy)

    def release(e):
        if state["start"]:
            sx, sy = state["start"]
            x0, x1 = sorted((sx, e.x_root))
            y0, y1 = sorted((sy, e.y_root))
            if x1 - x0 >= 8 and y1 - y0 >= 8:
                state["result"] = (x0, y0, x1 - x0, y1 - y0)
        top.destroy()

    canvas.bind("<ButtonPress-1>", press)
    canvas.bind("<B1-Motion>", drag)
    canvas.bind("<ButtonRelease-1>", release)
    top.bind("<Escape>", lambda e: top.destroy())
    top.focus_force()
    root.wait_window(top)
    return state["result"]


class App:
    def __init__(self, root):
        self.root = root
        root.title("Thumbnail Capture")
        root.attributes("-topmost", True)
        root.resizable(False, False)
        cfg = {}
        try:
            cfg = json.loads(CONFIG.read_text())
        except Exception:
            pass
        self.region = tuple(cfg["region"]) if cfg.get("region") else None
        self.out_dir = tk.StringVar(value=cfg.get("out_dir", str(DEFAULT_OUT)))
        self.size = tk.StringVar(value=cfg.get("size", ""))
        self.custom_cars = list(cfg.get("custom_cars", []))
        self.cars = dr2_cars(self.custom_cars)
        self.name = tk.StringVar()
        self.region_text = tk.StringVar()
        self.status = tk.StringVar(value="Pick a region, then press F9.")
        self.counter = 1
        self.was_down = False

        pad = {"padx": 8, "pady": 4}
        f = tk.Frame(root)
        f.pack(padx=6, pady=6)
        tk.Label(f, text="Car").grid(row=0, column=0, sticky="w", **pad)
        entry = ttk.Combobox(f, textvariable=self.name, values=self.cars, width=34)
        entry.grid(row=0, column=1, columnspan=2, sticky="we", **pad)
        entry.bind("<Return>", lambda e: self.capture())
        entry.bind("<KeyRelease>", self.filter_cars)
        tk.Label(f, text="Folder").grid(row=1, column=0, sticky="w", **pad)
        tk.Entry(f, textvariable=self.out_dir, width=34).grid(row=1, column=1, **pad)
        tk.Button(f, text="…", command=self.browse).grid(row=1, column=2, **pad)
        tk.Label(f, text="Output size").grid(row=2, column=0, sticky="w", **pad)
        tk.Entry(f, textvariable=self.size, width=12).grid(row=2, column=1, sticky="w", **pad)
        tk.Label(f, text="e.g. 512x288, blank = native", fg="#666").grid(
            row=2, column=1, columnspan=2, sticky="e", **pad)
        tk.Label(f, textvariable=self.region_text, fg="#333").grid(
            row=3, column=0, columnspan=3, sticky="w", **pad)
        buttons = tk.Frame(f)
        buttons.grid(row=4, column=0, columnspan=3, sticky="we")
        tk.Button(buttons, text="Select region", command=self.select).pack(side="left", **pad)
        tk.Button(buttons, text="Move region", command=self.move).pack(side="left", **pad)
        nudge = tk.Frame(f)
        nudge.grid(row=5, column=0, columnspan=3, sticky="w")
        tk.Label(nudge, text="Nudge (Shift = 10px)").pack(side="left", **pad)
        for label, dx, dy in (("◀", -1, 0), ("▲", 0, -1), ("▼", 0, 1), ("▶", 1, 0)):
            b = tk.Button(nudge, text=label, width=3)
            b.bind("<Button-1>", lambda e, dx=dx, dy=dy: self.nudge(dx, dy, e.state & 1))
            b.pack(side="left", padx=2)
        tk.Button(f, text="Capture (F9)", command=self.capture, default="active").grid(
            row=6, column=0, columnspan=3, sticky="we", **pad)
        tk.Label(f, textvariable=self.status, fg="#0a6", wraplength=300, justify="left").grid(
            row=7, column=0, columnspan=3, sticky="w", **pad)
        self.entry = entry
        self.refresh_region()
        entry.focus_set()
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.poll()

    def refresh_region(self):
        if self.region:
            x, y, w, h = self.region
            self.region_text.set(f"Region: {w}x{h} at ({x}, {y})")
        else:
            self.region_text.set("Region: not set")

    def save_config(self):
        CONFIG.write_text(json.dumps({
            "region": self.region, "out_dir": self.out_dir.get(), "size": self.size.get(),
            "custom_cars": self.custom_cars,
        }, indent=2))

    def filter_cars(self, event):
        if event.keysym in ("Up", "Down", "Return", "Escape", "Tab"):
            return
        typed = self.name.get().strip().lower()
        self.entry["values"] = [c for c in self.cars if typed in c.lower()] or self.cars

    def browse(self):
        d = filedialog.askdirectory(initialdir=self.out_dir.get(), parent=self.root)
        if d:
            self.out_dir.set(d)
            self.save_config()

    def select(self):
        self.root.withdraw()
        self.root.update()
        region = pick_region(self.root)
        self.root.deiconify()
        if region:
            self.region = region
            self.save_config()
            self.refresh_region()
            self.status.set("Region saved.")

    def move(self):
        if not self.region:
            self.status.set("Select a region first.")
            return
        self.root.withdraw()
        self.root.update()
        region = move_region(self.root, self.region)
        self.root.deiconify()
        if region:
            self.region = region
            self.save_config()
            self.refresh_region()
            self.status.set("Region moved.")

    def nudge(self, dx, dy, shift):
        if not self.region:
            return
        step = 10 if shift else 1
        x, y, w, h = self.region
        self.region = (x + dx * step, y + dy * step, w, h)
        self.save_config()
        self.refresh_region()

    def output_size(self):
        text = self.size.get().strip().lower().replace(" ", "")
        if not text:
            return self.region[2], self.region[3]
        w, _, h = text.partition("x")
        if not (w.isdigit() and h.isdigit() and int(w) > 0 and int(h) > 0):
            raise ValueError("Output size must look like 512x288")
        return int(w), int(h)

    def capture(self):
        if not self.region:
            self.status.set("Select a region first.")
            return
        try:
            out_w, out_h = self.output_size()
            out = Path(self.out_dir.get())
            out.mkdir(parents=True, exist_ok=True)
            stem = "".join(c for c in self.name.get().strip() if c not in '<>:"/\\|?*')
            if not stem:
                while (out / f"capture_{self.counter:04d}.png").exists():
                    self.counter += 1
                stem = f"capture_{self.counter:04d}"
            path = out / f"{stem}.png"
            existed = path.exists()
            x, y, w, h = self.region
            data = grab(x, y, w, h, out_w, out_h)
            write_png(path, data, out_w, out_h)
            if self.name.get().strip() and self.name.get().strip() not in self.cars:
                self.custom_cars.append(self.name.get().strip())
                self.cars = dr2_cars(self.custom_cars)
                self.entry["values"] = self.cars
            self.save_config()
            self.status.set(f"{'Replaced' if existed else 'Saved'} {path.name} ({out_w}x{out_h})")
            self.root.bell()
        except Exception as exc:
            self.status.set(f"Failed: {exc}")

    def poll(self):
        down = bool(user32.GetAsyncKeyState(HOTKEY_VK) & 0x8000)
        if down and not self.was_down:
            self.capture()
        self.was_down = down
        self.root.after(30, self.poll)

    def close(self):
        self.save_config()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
