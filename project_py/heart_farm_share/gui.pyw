#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Double-click GUI launcher (stdlib Tkinter, dark theme) for the Gift Draw tool.

It runs the existing gift_draw.py as a subprocess, streams its output into a
console panel, and feeds the values you type in the form to the script's
prompts -- so the working script is NOT modified. Anything the script asks that
the form did not cover can be typed in the input box at the bottom.

Run it by double-clicking:
  * Windows : gui.pyw   (or run_gui.bat)
  * macOS   : run_gui.command
  * anywhere: python gui.pyw
"""

import os

# ======================= PER-PROJECT SPEC (edit me) ========================
APP_TITLE = "Cookie Run — Heart Farm"
SUBTITLE = "ปั๊มหัวใจอัตโนมัติ (เพื่อนจริงไม่ถูกแตะ)"
FLOW = [
    "1) Login บัญชีหลัก",
    "2) ใส่ Proxy URL (เว้นว่างได้ ถ้าไม่มี)",
    "3) ใส่จำนวนหัวใจที่ต้องการ",
    "4) วนสร้าง guest → แอด → ส่งหัวใจ → เก็บ → ลบ guest จนครบ",
]

# each field: key, label, kind. kind in {text, password, int, choice}
FIELDS = [
    {"key": "email", "label": "DevPlay Email", "kind": "text"},
    {"key": "password", "label": "DevPlay Password", "kind": "password"},
    {"key": "proxy", "label": "Proxy URL (เว้นว่าง = ไม่ใช้)", "kind": "text"},
    {"key": "target", "label": "จำนวนหัวใจที่ต้องการ (เว้นว่าง = 100)", "kind": "int"},
    {"key": "conc", "label": "FAST: concurrency เขียนบัญชี (เว้นว่าง = 6 • เสี่ยง ban)",
     "kind": "int", "fast_only": True},
]

# script filenames. "fast" is optional (adds a FAST toggle if present).
NORMAL_SCRIPT = "heart_farm.py"
FAST_SCRIPT = "heart_farm_fast.py"

# sibling files that must exist before running (checked, friendly error)
REQUIRED_FILES = ["_descriptors.bin"]


def build_stdin(v, fast):
    """Answers fed to the script's input() prompts, in order.
    normal: email, password, proxy, target.
    fast:   ... + concurrency + a [y/N] aggression confirm."""
    lines = [v["email"], v["password"], v.get("proxy", ""), v.get("target", "")]
    if fast:
        lines += [v.get("conc", ""), "y"]
    return lines
# ===========================================================================


# =========================== GUI ENGINE (shared) ===========================
import sys
import queue
import threading
import subprocess
import tkinter as tk
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText

HERE = os.path.dirname(os.path.abspath(__file__))

# Catppuccin-ish dark palette
C_BG = "#1e1e2e"
C_PANEL = "#181825"
C_CARD = "#252537"
C_FG = "#cdd6f4"
C_MUTED = "#9399b2"
C_ACCENT = "#89b4fa"
C_ENTRY = "#313244"
C_CONSOLE = "#11111b"
C_OK = "#a6e3a1"
C_ERR = "#f38ba8"
C_WARN = "#f9e2af"
MONO = ("Consolas", 10) if sys.platform.startswith("win") else ("Menlo", 11)
UIFONT = ("Segoe UI", 10) if sys.platform.startswith("win") else ("Helvetica", 12)


class LauncherApp:
    def __init__(self, root):
        self.root = root
        self.proc = None
        self.q = queue.Queue()
        self.vars = {}
        self.fast = tk.BooleanVar(value=False)
        self._build_ui()
        self.root.after(60, self._drain)

    # ---------- UI ----------
    def _build_ui(self):
        r = self.root
        r.title(APP_TITLE)
        r.configure(bg=C_BG)
        r.geometry("760x620")
        r.minsize(640, 520)

        style = ttk.Style(r)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=C_BG)
        style.configure("Card.TFrame", background=C_CARD)
        style.configure("TLabel", background=C_BG, foreground=C_FG, font=UIFONT)
        style.configure("Muted.TLabel", background=C_BG, foreground=C_MUTED, font=(UIFONT[0], UIFONT[1] - 1))
        style.configure("Card.TLabel", background=C_CARD, foreground=C_FG, font=UIFONT)
        style.configure("Head.TLabel", background=C_BG, foreground=C_FG, font=(UIFONT[0], 17, "bold"))
        style.configure("Sub.TLabel", background=C_BG, foreground=C_ACCENT, font=(UIFONT[0], 11))
        style.configure("TEntry", fieldbackground=C_ENTRY, foreground=C_FG,
                        insertcolor=C_FG, bordercolor=C_ENTRY, padding=6)
        style.configure("TCheckbutton", background=C_BG, foreground=C_FG, font=UIFONT)
        style.map("TCheckbutton", background=[("active", C_BG)])
        style.configure("Accent.TButton", background=C_ACCENT, foreground="#11111b",
                        font=(UIFONT[0], 11, "bold"), padding=8, borderwidth=0)
        style.map("Accent.TButton", background=[("active", "#b4befe"), ("disabled", "#45475a")])
        style.configure("Stop.TButton", background=C_ERR, foreground="#11111b",
                        font=(UIFONT[0], 11, "bold"), padding=8, borderwidth=0)
        style.map("Stop.TButton", background=[("active", "#eba0ac"), ("disabled", "#45475a")])
        style.configure("TCombobox", fieldbackground=C_ENTRY, background=C_ENTRY, foreground=C_FG)

        # header
        head = ttk.Frame(r)
        head.pack(fill="x", padx=18, pady=(16, 6))
        ttk.Label(head, text=APP_TITLE, style="Head.TLabel").pack(anchor="w")
        ttk.Label(head, text=SUBTITLE, style="Sub.TLabel").pack(anchor="w", pady=(2, 0))
        ttk.Label(head, text="   ".join(FLOW), style="Muted.TLabel", wraplength=720,
                  justify="left").pack(anchor="w", pady=(6, 0))

        # form card
        card = ttk.Frame(r, style="Card.TFrame")
        card.pack(fill="x", padx=18, pady=10)
        inner = ttk.Frame(card, style="Card.TFrame")
        inner.pack(fill="x", padx=14, pady=12)
        inner.columnconfigure(1, weight=1)

        row = 0
        for f in FIELDS:
            lbl = ttk.Label(inner, text=f["label"], style="Card.TLabel")
            lbl.grid(row=row, column=0, sticky="w", pady=6, padx=(0, 12))
            if f["kind"] == "choice":
                var = tk.StringVar(value=f.get("options", [("", "")])[0][0])
                w = ttk.Combobox(inner, textvariable=var, state="readonly",
                                 values=[o[0] for o in f["options"]])
                f["_map"] = {o[0]: o[1] for o in f["options"]}
            else:
                var = tk.StringVar(value=f.get("default", ""))
                show = "•" if f["kind"] == "password" else ""
                w = ttk.Entry(inner, textvariable=var, show=show)
            w.grid(row=row, column=1, sticky="ew", pady=6)
            self.vars[f["key"]] = (var, f)
            if f.get("fast_only"):
                f["_widget"] = w
                f["_label"] = lbl
            row += 1

        if FAST_SCRIPT:
            fr = ttk.Frame(inner, style="Card.TFrame")
            fr.grid(row=row, column=0, columnspan=2, sticky="w", pady=(4, 0))
            cb = ttk.Checkbutton(fr, text="โหมด FAST (เร็วขึ้น • เสี่ยงมากขึ้น)",
                                 variable=self.fast, command=self._toggle_fast, style="TCheckbutton")
            cb.pack(side="left")
            self._toggle_fast()

        # buttons
        btns = ttk.Frame(r)
        btns.pack(fill="x", padx=18, pady=(2, 8))
        self.start_btn = ttk.Button(btns, text="▶  Start", style="Accent.TButton", command=self.start)
        self.start_btn.pack(side="left")
        self.stop_btn = ttk.Button(btns, text="■  Stop", style="Stop.TButton", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left", padx=(8, 0))
        self.status = ttk.Label(btns, text="พร้อมใช้งาน", style="Muted.TLabel")
        self.status.pack(side="right")

        # console
        self.console = ScrolledText(r, bg=C_CONSOLE, fg=C_FG, insertbackground=C_FG,
                                    font=MONO, relief="flat", padx=10, pady=8, wrap="word",
                                    height=14, borderwidth=0)
        self.console.pack(fill="both", expand=True, padx=18, pady=(0, 8))
        self.console.tag_config("ok", foreground=C_OK)
        self.console.tag_config("err", foreground=C_ERR)
        self.console.tag_config("sys", foreground=C_ACCENT)
        self.console.configure(state="disabled")

        # manual input row (for any prompt the form did not cover)
        inp = ttk.Frame(r)
        inp.pack(fill="x", padx=18, pady=(0, 14))
        self.input_var = tk.StringVar()
        self.input_entry = ttk.Entry(inp, textvariable=self.input_var)
        self.input_entry.pack(side="left", fill="x", expand=True)
        self.input_entry.bind("<Return>", lambda e: self.send_line())
        ttk.Button(inp, text="ส่ง", style="Accent.TButton", command=self.send_line).pack(side="left", padx=(8, 0))

    def _toggle_fast(self):
        on = self.fast.get()
        for f in FIELDS:
            if f.get("fast_only") and f.get("_widget") is not None:
                f["_widget"].configure(state=("normal" if on else "disabled"))

    # ---------- process control ----------
    def start(self):
        if self.proc is not None:
            return
        fast = bool(FAST_SCRIPT) and self.fast.get()
        vals = {}
        for key, (var, f) in self.vars.items():
            raw = var.get().strip()
            if f["kind"] == "choice":
                raw = f["_map"].get(raw, raw)
            vals[key] = raw
        if not vals.get("email") or not vals.get("password"):
            self._log("!! ต้องกรอก Email และ Password ก่อน\n", "err")
            return
        # field-level validation (required / integers)
        for key, (var, f) in self.vars.items():
            if f.get("fast_only") and not fast:
                continue
            val = vals.get(key, "")
            if f.get("required") and not val:
                self._log("!! ต้องกรอก: %s\n" % f["label"], "err")
                return
            if f["kind"] == "int" and val:
                if not val.lstrip("-").isdigit() or (f.get("required") and int(val) <= 0):
                    self._log("!! %s ต้องเป็นตัวเลข%s\n"
                              % (f["label"], "มากกว่า 0" if f.get("required") else ""), "err")
                    return
        for rf in REQUIRED_FILES:
            if not os.path.exists(os.path.join(HERE, rf)):
                self._log("!! ไม่พบไฟล์ที่จำเป็น: %s (ต้องอยู่โฟลเดอร์เดียวกัน)\n" % rf, "err")
                return

        script = FAST_SCRIPT if fast else NORMAL_SCRIPT
        self._clear_console()
        self._log("[GUI] เริ่มรัน %s ...\n" % script, "sys")

        cmd = [sys.executable, "-u", os.path.join(HERE, script)]
        kw = {}
        if os.name == "nt":
            kw["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        try:
            self.proc = subprocess.Popen(
                cmd, cwd=HERE, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", bufsize=1, **kw)
        except Exception as e:
            self._log("!! เปิดโปรเซสไม่สำเร็จ: %s\n" % e, "err")
            self.proc = None
            return

        # feed the known answers to the script's prompts
        try:
            for line in build_stdin(vals, fast):
                self.proc.stdin.write((line or "") + "\n")
            self.proc.stdin.flush()
        except Exception:
            pass

        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self.status.configure(text="กำลังทำงาน...")
        threading.Thread(target=self._reader, daemon=True).start()

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except Exception:
                pass
            self._log("\n[GUI] สั่งหยุดแล้ว\n", "sys")

    def send_line(self):
        text = self.input_var.get()
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.write(text + "\n")
                self.proc.stdin.flush()
                self._log("> %s\n" % text, "sys")
            except Exception:
                pass
        self.input_var.set("")

    # ---------- output streaming ----------
    def _reader(self):
        try:
            for line in iter(self.proc.stdout.readline, ""):
                self.q.put(line)
        except Exception:
            pass
        self.q.put(None)  # sentinel: process ended

    def _drain(self):
        try:
            while True:
                item = self.q.get_nowait()
                if item is None:
                    self._on_exit()
                else:
                    self._log(item)
        except queue.Empty:
            pass
        self.root.after(60, self._drain)

    def _on_exit(self):
        code = self.proc.poll() if self.proc else None
        self.proc = None
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")
        self.status.configure(text="จบการทำงาน (exit %s)" % code)
        self._log("\n[GUI] จบการทำงาน (exit code %s)\n" % code, "ok" if code == 0 else "err")

    # ---------- console helpers ----------
    def _tag_for(self, text):
        low = text.lower()
        if any(k in text for k in ("!!", "FAIL", "ERROR", "error", "ไม่สำเร็จ", "ผิดพลาด")):
            return "err"
        if any(k in text for k in ("[+]", "OK", "DONE", "สำเร็จ", "✓", "✅")):
            return "ok"
        return None

    def _log(self, text, tag=None):
        self.console.configure(state="normal")
        self.console.insert("end", text, tag or self._tag_for(text))
        self.console.see("end")
        self.console.configure(state="disabled")

    def _clear_console(self):
        self.console.configure(state="normal")
        self.console.delete("1.0", "end")
        self.console.configure(state="disabled")


def main():
    root = tk.Tk()
    LauncherApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
