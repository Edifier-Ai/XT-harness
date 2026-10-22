// 察言观色 and 拖给小天: what is in front on the desktop (which app, its title, where its window is) and which window
// lies under a point. Windows asks user32 through one long-running PowerShell; the Mac asks AppKit and CoreGraphics
// through one long-running JXA (osascript -l JavaScript). Both answer one JSON line per request line. Elsewhere, or
// when the helper cannot start, every answer is null and nothing is held back because of it.
// Rects come back in the helper's own pixels: physical pixels on Windows (the helper is per-monitor DPI aware),
// points on the Mac. The shell turns them into Electron's DIP coordinates.
'use strict'
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const PS = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
public static class XtRoom {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int n);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int n);
  public static void Init() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }
  static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  // the visible frame (DWM), not the rect with the invisible resize borders around it
  static RECT Rect(IntPtr h) { RECT r; if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r); return r; }
  static bool Cloaked(IntPtr h) { int v; return DwmGetWindowAttribute(h, 14, out v, 4) == 0 && v != 0; }
  static string Exe(uint pid) { try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; } }
  static string Esc(string s) { var b = new StringBuilder(); foreach (var c in s ?? "") { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.Append(' '); else b.Append(c); } return b.ToString(); }
  static string Json(IntPtr h, uint pid) {
    var r = Rect(h);
    return "{\"id\":\"" + h.ToInt64() + "\",\"pid\":" + pid + ",\"app\":\"" + Esc(Exe(pid)) + "\",\"title\":\"" + Esc(Text(h)) + "\",\"cls\":\"" + Esc(Cls(h)) + "\",\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + "}";
  }
  static bool IsDesk(string cls) { return cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd"; }
  public static string Front() {
    IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return "null";
    if (IsDesk(Cls(h))) return "{\"desktop\":true}";
    uint pid; GetWindowThreadProcessId(h, out pid); return Json(h, pid);
  }
  // the top-most real window under the point, skipping the given processes (小天's own windows: the orb is under the pointer)
  public static string At(int x, int y, string skip) {
    var skips = new HashSet<string>(skip.Split(','));
    string found = "null";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h) || Cloaked(h)) return true;
      if ((GetWindowLong(h, -20) & 0x20) != 0) return true;   // WS_EX_TRANSPARENT: click-through overlays
      var r = Rect(h); if (x < r.L || x >= r.R || y < r.T || y >= r.B) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (skips.Contains(pid.ToString())) return true;
      if (IsDesk(Cls(h))) { found = "{\"desktop\":true}"; return false; }
      found = Json(h, pid); return false;
    }, IntPtr.Zero);
    return found;
  }
  // apps using the microphone right now (Windows keeps LastUsedTimeStop at 0 while one is)
  public static string Mic(string self) {
    var list = new List<string>();
    try { using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone")) { if (k != null) Walk(k, list, self, 0); } } catch { }
    var b = new StringBuilder("[");
    for (int i = 0; i < list.Count; i++) { if (i > 0) b.Append(','); b.Append('"').Append(Esc(list[i])).Append('"'); }
    return b.Append(']').ToString();
  }
  static void Walk(RegistryKey k, List<string> list, string self, int depth) {
    foreach (var n in k.GetSubKeyNames()) {
      using (var s = k.OpenSubKey(n)) {
        if (s == null) continue;
        object stop = s.GetValue("LastUsedTimeStop"), start = s.GetValue("LastUsedTimeStart");
        if (stop != null && start != null) {
          if (Convert.ToInt64(stop) == 0 && Convert.ToInt64(start) > 0 && (self == "" || n.IndexOf(self, StringComparison.OrdinalIgnoreCase) < 0)) list.Add(n.Substring(n.LastIndexOf('#') + 1));
        } else if (depth == 0) Walk(s, list, self, 1);
      }
    }
  }
}
'@
[XtRoom]::Init()
$self = if ($args.Count -gt 0) { $args[0] } else { '' }
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Trim().Split(' ')
  try {
    if ($p[0] -eq 'front') { $o = '{"front":' + [XtRoom]::Front() + ',"mic":' + [XtRoom]::Mic($self) + '}' }
    elseif ($p[0] -eq 'at') { $o = '{"at":' + [XtRoom]::At([int]$p[1], [int]$p[2], $(if ($p.Count -gt 3) { $p[3] } else { '' })) + '}' }
    else { $o = '{}' }
  } catch { $o = '{"error":"' + ($_.Exception.Message -replace '["\\\r\n]', ' ') + '"}' }
  [Console]::Out.WriteLine($o)
  [Console]::Out.Flush()
}
`

const JXA = String.raw`
ObjC.import('AppKit'); ObjC.import('CoreGraphics'); ObjC.import('Foundation')
const stdout = $.NSFileHandle.fileHandleWithStandardOutput
function out(o) { stdout.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)) }
// on-screen windows, front to back, without the desktop itself (1 = on screen only, 16 = no desktop elements)
function wins() { return ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [] }
const W = (w) => ({ id: String(w.kCGWindowNumber), pid: w.kCGWindowOwnerPID, app: w.kCGWindowOwnerName || '', title: w.kCGWindowName || '', x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height })
const real = (w) => w.kCGWindowLayer === 0 && w.kCGWindowAlpha > 0 && w.kCGWindowBounds && w.kCGWindowBounds.Width > 40 && w.kCGWindowBounds.Height > 40
function front() {
  const a = $.NSWorkspace.sharedWorkspace.frontmostApplication
  if (!a || !a.processIdentifier) return null
  const pid = a.processIdentifier, name = ObjC.unwrap(a.localizedName) || ''
  if (ObjC.unwrap(a.bundleIdentifier) === 'com.apple.finder' && !wins().some((w) => w.kCGWindowOwnerPID === pid && real(w))) return { desktop: true }
  const w = wins().find((x) => x.kCGWindowOwnerPID === pid && real(x))
  const o = w ? W(w) : { id: '', pid: pid, title: '', x: 0, y: 0, w: 0, h: 0 }
  o.app = name
  return o
}
function at(x, y, skip) {
  const s = skip.split(',')
  for (const w of wins()) {
    if (!real(w) || s.indexOf(String(w.kCGWindowOwnerPID)) >= 0) continue
    const b = w.kCGWindowBounds
    if (x < b.X || y < b.Y || x >= b.X + b.Width || y >= b.Y + b.Height) continue
    return W(w)
  }
  return { desktop: true }
}
const stdin = $.NSFileHandle.fileHandleWithStandardInput
out({ ready: true })
let buf = ''
for (;;) {
  const d = stdin.availableData
  if (!d || d.length === 0) break
  buf += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding))
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const p = buf.slice(0, i).trim().split(' '); buf = buf.slice(i + 1)
    try {
      if (p[0] === 'front') out({ front: front(), mic: [] })
      else if (p[0] === 'at') out({ at: at(+p[1], +p[2], p[3] || '') })
      else out({})
    } catch (e) { out({ error: String(e) }) }
  }
}
`

/** Start the helper for this platform. log(msg) gets its troubles. self: a piece of 小天's own exe path (left out of the
 * microphone list, since talking to 小天 by voice is not a meeting). */
function createRoom({ log = () => {}, self = '' } = {}) {
  let child = null, ready = false, dead = false, buf = ''
  const waiting = []   // resolvers, one per request line, answered in order
  function start() {
    try {
      if (process.platform === 'win32') {
        const f = path.join(os.tmpdir(), `xt-room-${crypto.createHash('md5').update(PS).digest('hex').slice(0, 8)}.ps1`)
        if (!fs.existsSync(f)) fs.writeFileSync(f, PS)
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f, self], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      } else if (process.platform === 'darwin') {
        child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA], { stdio: ['pipe', 'pipe', 'pipe'] })
      } else return
    } catch (e) { log('room: ' + e.message); return }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        let m = null; try { m = JSON.parse(line) } catch { log('room: ' + line.slice(0, 200)); continue }
        if (m.ready) { ready = true; continue }
        if (m.error) log('room: ' + m.error)
        const w = waiting.shift(); if (w) w(m)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => log('room: ' + String(d).trim().slice(0, 400)))
    child.on('exit', (code) => {
      log('room: helper exited ' + code)
      child = null; ready = false
      while (waiting.length) waiting.shift()(null)
      // started again on the next request, but give up after it keeps dying
      if (++fails > 5) dead = true
    })
    child.stdin.on('error', () => {})
  }
  let fails = 0
  function ask(line, ms = 3000) {
    if (dead) return Promise.resolve(null)
    if (!child) start()
    if (!child) return Promise.resolve(null)
    return new Promise((res) => {
      let done = false
      const fin = (v) => { if (!done) { done = true; clearTimeout(t); res(v) } }
      const t = setTimeout(() => { const i = waiting.indexOf(fin); if (i >= 0) waiting[i] = () => {}; fin(null) }, ready ? ms : ms + 8000)
      waiting.push(fin)
      try { child.stdin.write(line + '\n') } catch { fin(null) }
    })
  }
  return {
    supported: process.platform === 'win32' || process.platform === 'darwin',
    /** {front: window|{desktop:true}|null, mic: [app names]} */
    front: () => ask('front'),
    /** the window under a point (helper pixels), skipping these process ids: window | {desktop:true} | null */
    at: async (x, y, skip = []) => (await ask(`at ${Math.round(x)} ${Math.round(y)} ${skip.join(',') || '0'}`))?.at ?? null,
    stop: () => { dead = true; try { child?.kill() } catch {} },
  }
}

module.exports = { createRoom }
