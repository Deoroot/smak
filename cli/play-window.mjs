// The game's window, for the Steam game's driver (cli/play-native.mjs): its pictures as the person sees them, the
// text of a box it shows, and real keys and mouse buttons sent to it. Windows only.
//
//   const window = windowHelper({ pid: child.pid, quiet: 5000 });
//   await window.ask("windows");         // { windows: [{ hwnd, cls, title, w, h, front, text }] }
//   await window.ask("shot C:/work/a.png");
//   await window.ask("key down 17 0");   // W, by its scan code; refused unless it may be sent
//   await window.close();
//
// A helper of C#, compiled by PowerShell (Windows has both) and started once, the first time it is asked;
// it reads one line a command from its input and answers one line of JSON. Nothing else is installed.
//
// WHAT IT KEEPS TO (docs/history/PLAN.md, 3c, after universal-modder's rules):
//   - only the windows of the one process it is given, by its id: never a window or a program by its name;
//   - a key or a button is sent only while that process's window is in front. It never brings it in front;
//   - not while the person is using the machine: the first input waits until the keyboard and mouse have been
//     left alone `quiet` milliseconds, and any input after the helper's own last one (a key, the mouse moved)
//     refuses everything from then on. Windows counts the helper's own input too, so "after its own" is the
//     measure: GetLastInputInfo later than the helper's last SendInput by more than a tick's slack;
//   - what it holds down it lets go (`release`), refused or not, so no key stays down;
//   - pictures: PrintWindow with PW_RENDERFULLCONTENT, which draws a window of the graphics card covered or
//     not; when that comes out black and the window is in front, the screen's pixels where it is.
import { spawn as spawnProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Milliseconds a command is given to be answered (the first: the helper compiled, about 2 s). */
const ANSWER_WITHIN = 30000;

/**
 * Playwright's names of the keys (the browser driver's), as the keyboard's scan codes (set 1): `[code, extended]`.
 * A letter or a digit is itself; the rest by name.
 */
const NAMED = {
  Escape: [0x01], Backspace: [0x0e], Tab: [0x0f], Enter: [0x1c], Space: [0x39], " ": [0x39],
  Control: [0x1d], ControlLeft: [0x1d], ControlRight: [0x1d, 1], Shift: [0x2a], ShiftLeft: [0x2a],
  ShiftRight: [0x36], Alt: [0x38], AltLeft: [0x38], AltRight: [0x38, 1], CapsLock: [0x3a],
  Minus: [0x0c], "-": [0x0c], Equal: [0x0d], "=": [0x0d], BracketLeft: [0x1a], "[": [0x1a],
  BracketRight: [0x1b], "]": [0x1b], Semicolon: [0x27], ";": [0x27], Quote: [0x28], "'": [0x28],
  Backquote: [0x29], "`": [0x29], Backslash: [0x2b], "\\": [0x2b], Comma: [0x33], ",": [0x33],
  Period: [0x34], ".": [0x34], Slash: [0x35], "/": [0x35],
  ArrowUp: [0x48, 1], ArrowDown: [0x50, 1], ArrowLeft: [0x4b, 1], ArrowRight: [0x4d, 1],
  Insert: [0x52, 1], Delete: [0x53, 1], Home: [0x47, 1], End: [0x4f, 1], PageUp: [0x49, 1], PageDown: [0x51, 1],
  F1: [0x3b], F2: [0x3c], F3: [0x3d], F4: [0x3e], F5: [0x3f], F6: [0x40], F7: [0x41], F8: [0x42], F9: [0x43],
  F10: [0x44], F11: [0x57], F12: [0x58],
}; // prettier-ignore
const LETTERS = "qwertyuiop asdfghjkl zxcvbnm";
const LETTER_CODES = [0x10, 0x1e, 0x2c]; // the first scan code of each row of LETTERS
const DIGITS = "1234567890";

/** A key's scan code and whether it is an extended one, by Playwright's name ("w", "KeyW", "Enter"); or null. */
export function scanOf(key) {
  if (typeof key !== "string") return null;
  if (Object.hasOwn(NAMED, key)) return { code: NAMED[key][0], extended: Boolean(NAMED[key][1]) };
  const letter = /^(?:Key)?([A-Za-z])$/.exec(key)?.[1].toLowerCase();
  if (letter) {
    const rows = LETTERS.split(" ");
    const row = rows.findIndex((each) => each.includes(letter));
    return { code: LETTER_CODES[row] + rows[row].indexOf(letter), extended: false };
  }
  const digit = /^(?:Digit)?([0-9])$/.exec(key)?.[1];
  if (digit) return { code: 0x02 + DIGITS.indexOf(digit), extended: false };
  return null;
}

/** The names a key may be given by, said when one is not known. */
export const KEY_NAMES = `a letter or a digit ("w", "KeyW", "Digit1"), or ${Object.keys(NAMED).filter((name) => name.length > 1).join(", ")}`; // prettier-ignore

/** The C# of the helper: its commands are in `Run`. */
const SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class SmakWindow {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("kernel32.dll")] static extern uint GetTickCount();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint how);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  static uint pid;
  static int quiet;
  static long lastSent = -1;
  static bool spoiled;
  static readonly HashSet<string> held = new HashSet<string>();

  static string Q(string s) {
    var b = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ') b.Append(string.Format("\\u{0:x4}", (int)c));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }
  static string TextOf(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h, s, s.Capacity); return s.ToString(); }
  static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
  static uint PidOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }

  /** The process's visible windows, the largest first. */
  static List<IntPtr> Windows() {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => { if (PidOf(h) == pid && IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
    found.Sort((a, b) => Area(b).CompareTo(Area(a)));
    return found;
  }
  static long Area(IntPtr h) { RECT r; GetClientRect(h, out r); return (long)(r.R - r.L) * (r.B - r.T); }
  /** The game's own window: its largest that is not a box (a box is "#32770"). */
  static IntPtr GameWindow() {
    foreach (var h in Windows()) if (ClassOf(h) != "#32770") return h;
    return IntPtr.Zero;
  }
  static bool Front() { var f = GetForegroundWindow(); return f != IntPtr.Zero && PidOf(f) == pid; }
  static long Now() { return GetTickCount(); }
  static long LastInput() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return i.dwTime; }
  static long Idle() { return (uint)(Now() - LastInput()); }

  /** Why an input may not be sent now, or null. */
  static string Refusal() {
    if (spoiled) return "person";
    if (lastSent < 0 ? Idle() < quiet : (uint)(LastInput() - lastSent) > 250 && (uint)(LastInput() - lastSent) < 0x80000000u) {
      if (lastSent >= 0) spoiled = true;
      return "person";
    }
    if (!Front()) return "front";
    return null;
  }
  /** An input given to Windows; what refused it (a game run as administrator refuses a helper that is not). */
  static void Send(INPUT input) {
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
      throw new Exception("SendInput took nothing (error " + Marshal.GetLastWin32Error() + ")");
    lastSent = LastInput();
  }
  static INPUT Key(ushort scan, bool extended, bool up) {
    var i = new INPUT(); i.type = 1;
    // the scan code and the key it is (MAPVK_VSC_TO_VK_EX), so a game that reads either reads it
    i.u.ki.scan = scan;
    i.u.ki.vk = (ushort)MapVirtualKey(extended ? 0xE000u | scan : scan, 3);
    i.u.ki.flags = (extended ? 0x0001u : 0) | (up ? 0x0002u : 0);
    return i;
  }
  static INPUT Button(string which, bool up) {
    var i = new INPUT(); i.type = 0;
    i.u.mi.flags = which == "left" ? (up ? 0x0004u : 0x0002u) : which == "right" ? (up ? 0x0010u : 0x0008u) : (up ? 0x0040u : 0x0020u);
    return i;
  }
  static INPUT Move(int x, int y) {
    var i = new INPUT(); i.type = 0;
    int w = GetSystemMetrics(78), h = GetSystemMetrics(79), left = GetSystemMetrics(76), top = GetSystemMetrics(77);
    i.u.mi.dx = (int)Math.Round((x - left) * 65535.0 / Math.Max(1, w - 1));
    i.u.mi.dy = (int)Math.Round((y - top) * 65535.0 / Math.Max(1, h - 1));
    i.u.mi.flags = 0x0001 | 0x8000 | 0x4000;
    return i;
  }

  static string Shot(string file) {
    var h = GameWindow();
    if (h == IntPtr.Zero) return "{\"error\":\"no window\"}";
    if (IsIconic(h)) return "{\"error\":\"minimised\"}";
    RECT r; GetClientRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    if (w <= 0 || ht <= 0) return "{\"error\":\"empty\"}";
    string how = "print";
    using (var bmp = new Bitmap(w, ht, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(bmp)) {
        var dc = g.GetHdc();
        bool drawn = PrintWindow(h, dc, 3);
        g.ReleaseHdc(dc);
        if ((!drawn || Mean(bmp) < 1) && Front()) {
          var p = new POINT(); ClientToScreen(h, ref p);
          g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(w, ht));
          how = "screen";
        }
      }
      double mean = Mean(bmp);
      bmp.Save(file, ImageFormat.Png);
      return "{\"file\":" + Q(file) + ",\"how\":\"" + how + "\",\"w\":" + w + ",\"h\":" + ht + ",\"mean\":" + mean.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "}";
    }
  }
  /** The mean of a picture's channels, from a grid of its pixels. */
  static double Mean(Bitmap b) {
    double sum = 0; int n = 0;
    for (int y = 0; y < b.Height; y += Math.Max(1, b.Height / 48))
      for (int x = 0; x < b.Width; x += Math.Max(1, b.Width / 64)) { var c = b.GetPixel(x, y); sum += c.R + c.G + c.B; n += 3; }
    return n > 0 ? sum / n : 0;
  }
  static string WindowsJson() {
    var parts = new List<string>();
    var main = GameWindow();
    foreach (var h in Windows()) {
      RECT r; GetClientRect(h, out r);
      var cls = ClassOf(h);
      var text = new StringBuilder();
      if (cls == "#32770") EnumChildWindows(h, (c, l) => { if (ClassOf(c) == "Static") { var t = TextOf(c); if (t.Length > 0) text.Append(text.Length > 0 ? " " : "").Append(t); } return true; }, IntPtr.Zero);
      parts.Add("{\"hwnd\":" + h.ToInt64() + ",\"cls\":" + Q(cls) + ",\"title\":" + Q(TextOf(h)) + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"main\":" + (h == main ? "true" : "false") + ",\"text\":" + Q(text.ToString()) + "}");
    }
    return "{\"windows\":[" + string.Join(",", parts) + "],\"front\":" + (Front() ? "true" : "false") + ",\"idle\":" + Idle() + "}";
  }

  static string Do(string line) {
    var w = line.Split(' ');
    switch (w[0]) {
      case "windows": return WindowsJson();
      case "state": return "{\"front\":" + (Front() ? "true" : "false") + ",\"idle\":" + Idle() + ",\"window\":" + (GameWindow() != IntPtr.Zero ? "true" : "false") + ",\"spoiled\":" + (spoiled ? "true" : "false") + "}";
      case "shot": return Shot(line.Substring(5));
      case "release": {
        foreach (var k in held) {
          var p = k.Split(':');
          if (p[0] == "k") Send(Key(ushort.Parse(p[1]), p[2] == "1", true)); else Send(Button(p[1], true));
        }
        int n = held.Count; held.Clear();
        return "{\"released\":" + n + "}";
      }
      case "key": case "button": case "move": {
        string id = w[0] == "key" ? "k:" + w[2] + ":" + w[3] : w[0] == "button" ? "b:" + w[2] : null;
        bool up = w[1] == "up";
        // letting go of what it holds is always done: no key is left down
        if (up) {
          if (!held.Remove(id)) return "{\"sent\":false}";
          Send(w[0] == "key" ? Key(ushort.Parse(w[2]), w[3] == "1", true) : Button(w[2], true));
          return "{\"sent\":true}";
        }
        var refused = Refusal();
        if (refused != null) return "{\"refused\":\"" + refused + "\",\"idle\":" + Idle() + "}";
        if (w[0] == "move") {
          var h = GameWindow(); var p = new POINT(); p.X = int.Parse(w[2]); p.Y = int.Parse(w[3]);
          ClientToScreen(h, ref p);
          Send(Move(p.X, p.Y));
          return "{\"sent\":true}";
        }
        Send(w[0] == "key" ? Key(ushort.Parse(w[2]), w[3] == "1", false) : Button(w[2], false));
        held.Add(id);
        return "{\"sent\":true}";
      }
    }
    return "{\"error\":" + Q("unknown command " + w[0]) + "}";
  }

  public static void Run(int process, int quietMs) {
    SetProcessDPIAware();
    pid = (uint)process; quiet = quietMs;
    Console.Out.WriteLine("{\"up\":true}"); Console.Out.Flush();
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string answer;
      try { answer = Do(line.Trim()); } catch (Exception e) { answer = "{\"error\":" + Q(e.Message) + "}"; }
      Console.Out.WriteLine(answer); Console.Out.Flush();
    }
  }
}
`;

/** The PowerShell that compiles the helper and runs it: the process's id and the quiet milliseconds are its arguments. */
const SCRIPT = `$ErrorActionPreference = "Stop"
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
${SOURCE}
'@
[SmakWindow]::Run([int]$args[0], [int]$args[1])
`;

/**
 * The helper for one process's windows: `ask(line)` sends it a command and resolves to its answer (an object);
 * `close()` ends it. Started the first time it is asked.
 *   pid     the game's process id (the one the driver started)
 *   quiet   milliseconds the keyboard and mouse are left alone before the first input (5000)
 *   spawn   how a program is started (node's own; a test's fake helper)
 */
export function windowHelper({ pid, quiet = 5000, spawn = spawnProcess } = {}) {
  let child = null;
  let folder = null;
  let rest = "";
  const waiting = [];
  let ended = null;
  const start = () => {
    if (process.platform !== "win32" && spawn === spawnProcess)
      throw new Error("play: the game's window is reached on Windows only (its pictures, its keys and its mouse)");
    folder = mkdtempSync(join(tmpdir(), "smak-window-"));
    const file = join(folder, "window.ps1");
    writeFileSync(file, SCRIPT);
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, String(pid), String(quiet)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); // prettier-ignore
    let said = "";
    child.stderr?.on("data", (bytes) => (said += bytes.toString()));
    child.stdout.on("data", (bytes) => {
      const parts = (rest + bytes.toString()).split(/\r?\n/);
      rest = parts.pop();
      for (const part of parts) if (part.trim()) waiting.shift()?.answer(part);
    });
    child.on("exit", (code) => {
      ended = `the window helper ended (${code})${said.trim() ? `: ${said.trim().split(/\r?\n/)[0]}` : ""}`;
      for (const each of waiting.splice(0)) each.fail(new Error(`play: ${ended}`));
    });
    // its first line says it is up
    return wait();
  };
  const wait = () =>
    new Promise((answer, fail) => {
      const timer = setTimeout(() => fail(new Error(`play: the window helper did not answer in ${ANSWER_WITHIN / 1000} seconds`)), ANSWER_WITHIN); // prettier-ignore
      waiting.push({
        answer: (line) => (clearTimeout(timer), answer(line)),
        fail: (error) => (clearTimeout(timer), fail(error)),
      });
    });
  return {
    async ask(line) {
      if (ended) throw new Error(`play: ${ended}`);
      if (!child) await start();
      const answered = wait();
      child.stdin.write(`${line}\n`);
      const text = await answered;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`play: the window helper said ${JSON.stringify(text)}`);
      }
    },
    async close() {
      if (child && !ended) {
        child.stdin.end();
        for (let waited = 0; !ended && waited < 3000; waited += 50) await new Promise((done) => setTimeout(done, 50));
        if (!ended) child.kill();
      }
      if (folder) rmSync(folder, { recursive: true, force: true });
      child = null;
    },
  };
}
