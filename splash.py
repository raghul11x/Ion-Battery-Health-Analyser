"""
Adobe-Style Splash Screen for Phone Battery Health Analyzer.
Frameless, dark glassmorphic loading window with dynamic status ticker and glowing progress bar.
"""

from __future__ import annotations
import os
import sys
import time
import tkinter as tk
from typing import Optional
from PIL import Image, ImageTk

# Base asset discovery
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))

ICON_PATH = os.path.join(BASE_DIR, "frontend", "static", "assets", "icon-1024.png")
if not os.path.isfile(ICON_PATH):
    ICON_PATH = os.path.join(BASE_DIR, "frontend", "static", "assets", "favicon.ico")


class AdobeSplashScreen:
    """
    Renders an authentic, frameless Adobe-style application splash screen.
    Displays app branding, model version, live status ticker, and glowing progress bar.
    """

    def __init__(self, width: int = 560, height: int = 340):
        self.width = width
        self.height = height
        self.root = tk.Tk()
        self.root.title("Ion+")

        # Frameless window, always on top
        self.root.overrideredirect(True)
        self.root.wm_attributes("-topmost", True)

        # Center on primary screen
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        x = max(0, (screen_w - width) // 2)
        y = max(0, (screen_h - height) // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        # Deep space / dark glassmorphic palette
        self.bg_color = "#0B0C14"
        self.border_color = "#23263B"
        self.root.configure(bg=self.bg_color)

        self._photo = None
        self._build_ui()
        self.update_progress(5, "Initializing application environment...")

    def _build_ui(self):
        # Outer container with 1px sleek border
        self.frame = tk.Frame(
            self.root,
            bg=self.bg_color,
            highlightthickness=1,
            highlightbackground=self.border_color,
            highlightcolor=self.border_color,
        )
        self.frame.pack(fill=tk.BOTH, expand=True)

        # Top section: Header with Logo and Brand Typography
        top_frame = tk.Frame(self.frame, bg=self.bg_color)
        top_frame.pack(fill=tk.X, padx=36, pady=(32, 10))

        # Brand Icon
        if os.path.isfile(ICON_PATH):
            try:
                img = Image.open(ICON_PATH).convert("RGBA")
                img = img.resize((56, 56), Image.Resampling.LANCZOS)
                self._photo = ImageTk.PhotoImage(img)
                icon_lbl = tk.Label(top_frame, image=self._photo, bg=self.bg_color)
                icon_lbl.pack(side=tk.LEFT, padx=(0, 20))
            except Exception:
                pass

        # Text Block
        text_frame = tk.Frame(top_frame, bg=self.bg_color)
        text_frame.pack(side=tk.LEFT, fill=tk.Y)

        eyebrow = tk.Label(
            text_frame,
            text="INTELLIGENCE AT THE CORE",
            fg="#38BDF8",
            bg=self.bg_color,
            font=("Segoe UI", 8, "bold"),
        )
        eyebrow.pack(anchor=tk.W)

        title = tk.Label(
            text_frame,
            text="Ion+",
            fg="#FFFFFF",
            bg=self.bg_color,
            font=("Segoe UI", 24, "bold"),
        )
        title.pack(anchor=tk.W, pady=(0, 0))

        subtitle = tk.Label(
            text_frame,
            text="IEC 61960 Electrochemical Longevity & Hardware Diagnostics",
            fg="#94A3B8",
            bg=self.bg_color,
            font=("Segoe UI", 9),
        )
        subtitle.pack(anchor=tk.W, pady=(2, 0))

        # Middle Decorative Accent Line
        sep = tk.Frame(self.frame, height=1, bg="#1E2235")
        sep.pack(fill=tk.X, padx=36, pady=(24, 20))

        # Status Ticker Area
        status_frame = tk.Frame(self.frame, bg=self.bg_color)
        status_frame.pack(fill=tk.X, padx=36)

        self.status_lbl = tk.Label(
            status_frame,
            text="Initializing...",
            fg="#E2E8F0",
            bg=self.bg_color,
            font=("Segoe UI", 9),
            anchor=tk.W,
        )
        self.status_lbl.pack(fill=tk.X)

        self.progress_text = tk.Label(
            status_frame,
            text="0%",
            fg="#64748B",
            bg=self.bg_color,
            font=("Segoe UI", 9, "bold"),
            anchor=tk.E,
        )
        self.progress_text.place(relx=1.0, rely=0.0, anchor=tk.NE)

        # High-tech glowing progress bar canvas
        self.canvas_w = self.width - 72
        self.canvas_h = 4
        self.canvas = tk.Canvas(
            self.frame,
            width=self.canvas_w,
            height=self.canvas_h,
            bg="#161826",
            highlightthickness=0,
            bd=0,
        )
        self.canvas.pack(fill=tk.X, padx=36, pady=(12, 28))

        # Background track
        self.bar = self.canvas.create_rectangle(0, 0, 0, self.canvas_h, fill="#6366F1", outline="")

        # Bottom Info Footer (Adobe Style: Version and License)
        footer_frame = tk.Frame(self.frame, bg=self.bg_color)
        footer_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=36, pady=(0, 24))

        ver_lbl = tk.Label(
            footer_frame,
            text="Ion+ v2.4.0 · Production Release",
            fg="#475569",
            bg=self.bg_color,
            font=("Segoe UI", 8),
        )
        ver_lbl.pack(side=tk.LEFT)

        local_lbl = tk.Label(
            footer_frame,
            text="100% Local · Offline Architecture",
            fg="#475569",
            bg=self.bg_color,
            font=("Segoe UI", 8),
        )
        local_lbl.pack(side=tk.RIGHT)

        self.root.update()

    def update_progress(self, percent: float, status_text: Optional[str] = None):
        """Updates the progress bar width and status label smoothly."""
        pct = max(0.0, min(100.0, float(percent)))
        fill_w = int((pct / 100.0) * self.canvas_w)

        # Dynamic gradient color shift (Indigo #6366F1 -> Sky Blue #38BDF8 -> Emerald #22C55E)
        if pct < 50:
            color = "#6366F1"
        elif pct < 90:
            color = "#38BDF8"
        else:
            color = "#22C55E"

        self.canvas.coords(self.bar, 0, 0, fill_w, self.canvas_h)
        self.canvas.itemconfig(self.bar, fill=color)

        if status_text:
            self.status_lbl.config(text=status_text)
        self.progress_text.config(text=f"{int(pct)}%")

        try:
            self.root.update()
        except tk.TclError:
            pass

    def close(self):
        """Destroys the splash window."""
        try:
            self.root.destroy()
        except Exception:
            pass
