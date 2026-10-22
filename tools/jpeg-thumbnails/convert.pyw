"""JPEG Thumbnails: turn every image in a folder into a small JPEG.

Pick a folder (the thumbnail-capture "captures" folder by default), set a quality
and a max size, press Convert. Originals are never touched: the JPEGs go to a
separate output folder ("<folder>/jpeg" unless you pick another).
No third-party packages: tkinter + GDI+ via ctypes, which reads PNG, BMP, GIF,
TIFF and JPEG.

Run: double-click convert.pyw, or `pythonw convert.pyw`.
"""

import ctypes
import json
import tkinter as tk
from ctypes import wintypes
from pathlib import Path
from tkinter import filedialog

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
DEFAULT_IN = HERE.parent / "thumbnail-capture" / "captures"
EXTENSIONS = {".png", ".bmp", ".gif", ".tif", ".tiff", ".jpg", ".jpeg"}
DEFAULT_QUALITY = 75
DEFAULT_MAX_SIZE = "400"  # longest side in pixels; ~12 KB per car capture at quality 75

gdiplus = ctypes.windll.gdiplus
H = ctypes.c_void_p


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

    @classmethod
    def parse(cls, text):
        h = text.strip("{}").replace("-", "")
        return cls(int(h[0:8], 16), int(h[8:12], 16), int(h[12:16], 16),
                   (ctypes.c_ubyte * 8)(*bytes.fromhex(h[16:])))


class StartupInput(ctypes.Structure):
    _fields_ = [("GdiplusVersion", ctypes.c_uint32), ("DebugEventCallback", ctypes.c_void_p),
                ("SuppressBackgroundThread", wintypes.BOOL),
                ("SuppressExternalCodecs", wintypes.BOOL)]


class EncoderParameter(ctypes.Structure):
    _fields_ = [("Guid", GUID), ("NumberOfValues", wintypes.ULONG),
                ("Type", wintypes.ULONG), ("Value", ctypes.c_void_p)]


class EncoderParameters(ctypes.Structure):
    _fields_ = [("Count", wintypes.UINT), ("Parameter", EncoderParameter * 1)]


JPEG_ENCODER = GUID.parse("{557CF401-1A04-11D3-9A73-0000F81EF32E}")
ENCODER_QUALITY = GUID.parse("{1D5BE4B5-FA4A-452D-9CDD-5DB35105E7EB}")
VALUE_TYPE_LONG = 4
PIXEL_FORMAT_24BPP_RGB = 0x00021808
INTERPOLATION_HIGH_QUALITY_BICUBIC = 7
PIXEL_OFFSET_HIGH_QUALITY = 2
WRAP_TILE_FLIP_XY = 3  # stops the resize darkening the edges
UNIT_PIXEL = 2
WHITE = 0xFFFFFFFF  # what transparent pixels become

gdiplus.GdiplusStartup.argtypes = [ctypes.POINTER(ctypes.c_size_t),
                                   ctypes.POINTER(StartupInput), ctypes.c_void_p]
gdiplus.GdiplusShutdown.argtypes = [ctypes.c_size_t]
gdiplus.GdipLoadImageFromFile.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(H)]
gdiplus.GdipGetImageWidth.argtypes = [H, ctypes.POINTER(wintypes.UINT)]
gdiplus.GdipGetImageHeight.argtypes = [H, ctypes.POINTER(wintypes.UINT)]
gdiplus.GdipCreateBitmapFromScan0.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                              ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(H)]
gdiplus.GdipGetImageGraphicsContext.argtypes = [H, ctypes.POINTER(H)]
gdiplus.GdipSetInterpolationMode.argtypes = [H, ctypes.c_int]
gdiplus.GdipSetPixelOffsetMode.argtypes = [H, ctypes.c_int]
gdiplus.GdipGraphicsClear.argtypes = [H, wintypes.DWORD]
gdiplus.GdipCreateImageAttributes.argtypes = [ctypes.POINTER(H)]
gdiplus.GdipSetImageAttributesWrapMode.argtypes = [H, ctypes.c_int, wintypes.DWORD, wintypes.BOOL]
gdiplus.GdipDrawImageRectRectI.argtypes = [H, H] + [ctypes.c_int] * 9 + [H, ctypes.c_void_p,
                                                                         ctypes.c_void_p]
gdiplus.GdipSaveImageToFile.argtypes = [H, wintypes.LPCWSTR, ctypes.POINTER(GUID),
                                        ctypes.POINTER(EncoderParameters)]
gdiplus.GdipDisposeImageAttributes.argtypes = [H]
gdiplus.GdipDeleteGraphics.argtypes = [H]
gdiplus.GdipDisposeImage.argtypes = [H]


def check(status, what):
    if status != 0:
        raise OSError(f"{what} failed (GDI+ status {status})")


def fit(w, h, max_side):
    """Scale (w, h) down so the longest side is at most max_side; never scales up."""
    if not max_side or max(w, h) <= max_side:
        return w, h
    scale = max_side / max(w, h)
    return max(1, round(w * scale)), max(1, round(h * scale))


def to_jpeg(src, dst, quality, max_side):
    """Write src as a JPEG at dst, resized to fit max_side. Returns the output (w, h)."""
    image, bitmap, graphics, attrs = H(), H(), H(), H()
    try:
        check(gdiplus.GdipLoadImageFromFile(str(src), ctypes.byref(image)), "Reading")
        w, h = wintypes.UINT(), wintypes.UINT()
        gdiplus.GdipGetImageWidth(image, ctypes.byref(w))
        gdiplus.GdipGetImageHeight(image, ctypes.byref(h))
        out_w, out_h = fit(w.value, h.value, max_side)
        check(gdiplus.GdipCreateBitmapFromScan0(out_w, out_h, 0, PIXEL_FORMAT_24BPP_RGB, None,
                                                ctypes.byref(bitmap)), "Creating the bitmap")
        check(gdiplus.GdipGetImageGraphicsContext(bitmap, ctypes.byref(graphics)), "Drawing")
        gdiplus.GdipSetInterpolationMode(graphics, INTERPOLATION_HIGH_QUALITY_BICUBIC)
        gdiplus.GdipSetPixelOffsetMode(graphics, PIXEL_OFFSET_HIGH_QUALITY)
        gdiplus.GdipGraphicsClear(graphics, WHITE)
        check(gdiplus.GdipCreateImageAttributes(ctypes.byref(attrs)), "Drawing")
        gdiplus.GdipSetImageAttributesWrapMode(attrs, WRAP_TILE_FLIP_XY, 0, False)
        check(gdiplus.GdipDrawImageRectRectI(graphics, image, 0, 0, out_w, out_h,
                                             0, 0, w.value, h.value, UNIT_PIXEL,
                                             attrs, None, None), "Resizing")
        value = wintypes.ULONG(quality)
        params = EncoderParameters(1)
        params.Parameter[0] = EncoderParameter(ENCODER_QUALITY, 1, VALUE_TYPE_LONG,
                                               ctypes.cast(ctypes.byref(value), ctypes.c_void_p))
        check(gdiplus.GdipSaveImageToFile(bitmap, str(dst), ctypes.byref(JPEG_ENCODER),
                                          ctypes.byref(params)), "Saving")
        return out_w, out_h
    finally:
        if attrs:
            gdiplus.GdipDisposeImageAttributes(attrs)
        if graphics:
            gdiplus.GdipDeleteGraphics(graphics)
        if bitmap:
            gdiplus.GdipDisposeImage(bitmap)
        if image:
            gdiplus.GdipDisposeImage(image)  # releases the lock GDI+ holds on the source file


def kb(size):
    return f"{size / 1024:,.0f} KB" if size < 1024 * 1024 else f"{size / 1024 / 1024:,.1f} MB"


class App:
    def __init__(self, root):
        self.root = root
        root.title("JPEG Thumbnails")
        root.resizable(False, False)
        cfg = {}
        try:
            cfg = json.loads(CONFIG.read_text())
        except Exception:
            pass
        self.in_dir = tk.StringVar(value=cfg.get("in_dir", str(DEFAULT_IN)))
        self.out_dir = tk.StringVar(value=cfg.get("out_dir", ""))
        self.quality = tk.IntVar(value=cfg.get("quality", DEFAULT_QUALITY))
        self.max_size = tk.StringVar(value=cfg.get("max_size", DEFAULT_MAX_SIZE))
        self.status = tk.StringVar(value="Pick a folder, then press Convert.")
        self.queue = []
        self.totals = None

        token = ctypes.c_size_t()
        check(gdiplus.GdiplusStartup(ctypes.byref(token), ctypes.byref(StartupInput(1)), None),
              "Starting GDI+")
        self.token = token

        pad = {"padx": 8, "pady": 4}
        f = tk.Frame(root)
        f.pack(padx=6, pady=6)
        tk.Label(f, text="Images").grid(row=0, column=0, sticky="w", **pad)
        tk.Entry(f, textvariable=self.in_dir, width=40).grid(row=0, column=1, **pad)
        tk.Button(f, text="…", command=self.browse_in).grid(row=0, column=2, **pad)
        tk.Label(f, text="Save to").grid(row=1, column=0, sticky="w", **pad)
        tk.Entry(f, textvariable=self.out_dir, width=40).grid(row=1, column=1, **pad)
        tk.Button(f, text="…", command=self.browse_out).grid(row=1, column=2, **pad)
        tk.Label(f, text="blank = a \"jpeg\" folder inside Images", fg="#666").grid(
            row=2, column=1, sticky="w", padx=8)
        tk.Label(f, text="Quality").grid(row=3, column=0, sticky="w", **pad)
        tk.Scale(f, variable=self.quality, from_=10, to=95, orient="horizontal",
                 length=260).grid(row=3, column=1, columnspan=2, sticky="w", **pad)
        tk.Label(f, text="Max size").grid(row=4, column=0, sticky="w", **pad)
        tk.Entry(f, textvariable=self.max_size, width=12).grid(row=4, column=1, sticky="w", **pad)
        tk.Label(f, text="longest side in px, blank = native", fg="#666").grid(
            row=4, column=1, columnspan=2, sticky="e", **pad)
        self.button = tk.Button(f, text="Convert", command=self.start, default="active")
        self.button.grid(row=5, column=0, columnspan=3, sticky="we", **pad)
        tk.Label(f, textvariable=self.status, fg="#0a6", wraplength=360, justify="left").grid(
            row=6, column=0, columnspan=3, sticky="w", **pad)
        root.protocol("WM_DELETE_WINDOW", self.close)

    def save_config(self):
        CONFIG.write_text(json.dumps({
            "in_dir": self.in_dir.get(), "out_dir": self.out_dir.get(),
            "quality": self.quality.get(), "max_size": self.max_size.get(),
        }, indent=2))

    def browse_in(self):
        d = filedialog.askdirectory(initialdir=self.in_dir.get(), parent=self.root)
        if d:
            self.in_dir.set(d)
            self.save_config()

    def browse_out(self):
        d = filedialog.askdirectory(initialdir=self.out_dir.get() or self.in_dir.get(),
                                    parent=self.root)
        if d:
            self.out_dir.set(d)
            self.save_config()

    def max_side(self):
        text = self.max_size.get().strip().lower().removesuffix("px").strip()
        if not text:
            return None
        if not text.isdigit() or int(text) <= 0:
            raise ValueError("Max size must be a number of pixels, like 400")
        return int(text)

    def start(self):
        if self.queue:
            return
        try:
            src = Path(self.in_dir.get())
            if not src.is_dir():
                raise ValueError("Pick a folder of images first.")
            self.side = self.max_side()
            self.out = Path(self.out_dir.get()) if self.out_dir.get().strip() else src / "jpeg"
            self.out.mkdir(parents=True, exist_ok=True)
            files = sorted(p for p in src.iterdir()
                           if p.is_file() and p.suffix.lower() in EXTENSIONS)
            if not files:
                raise ValueError(f"No images in {src}")
        except Exception as exc:
            self.status.set(f"Failed: {exc}")
            return
        self.save_config()
        self.queue = files
        self.totals = {"done": 0, "skipped": 0, "failed": [], "before": 0, "after": 0,
                       "count": len(files)}
        self.button.configure(state="disabled")
        self.root.after(1, self.step)

    def step(self):
        """Convert one file per tick so the window keeps redrawing."""
        t = self.totals
        src = self.queue.pop(0)
        dst = self.out / f"{src.stem}.jpg"
        if dst.resolve() == src.resolve():
            t["skipped"] += 1  # a JPEG in the output folder itself: never overwrite an original
        else:
            try:
                to_jpeg(src, dst, self.quality.get(), self.side)
                t["done"] += 1
                t["before"] += src.stat().st_size
                t["after"] += dst.stat().st_size
            except Exception as exc:
                t["failed"].append(f"{src.name}: {exc}")
        n = t["done"] + t["skipped"] + len(t["failed"])
        self.status.set(f"Converting {n}/{t['count']}…  {src.name}")
        if self.queue:
            self.root.after(1, self.step)
        else:
            self.finish()

    def finish(self):
        t = self.totals
        msg = f"{t['done']} saved to {self.out}"
        if t["done"]:
            msg += (f"\n{kb(t['before'])} → {kb(t['after'])} "
                    f"({100 * t['after'] / t['before']:.0f}%), "
                    f"about {kb(t['after'] / t['done'])} each")
        if t["skipped"]:
            msg += f"\n{t['skipped']} skipped (would overwrite the original)"
        if t["failed"]:
            msg += f"\n{len(t['failed'])} failed: " + "; ".join(t["failed"][:3])
        self.status.set(msg)
        self.button.configure(state="normal")
        self.root.bell()

    def close(self):
        self.save_config()
        gdiplus.GdiplusShutdown(self.token)
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
