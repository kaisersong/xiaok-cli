// win-ctrlc-probe: deliver a REAL Ctrl+C (CTRL_C_EVENT) to a console child on Windows.
// Used by the release smoke (scripts/release/win-ctrlc-probe.ps1), typically run over `ssh yzjw`.
// Build: %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:probe.exe win-ctrlc-probe.cs
// Usage: probe.exe --log <file> [--ready "gateway started"] [--timeout 15] [--ready-timeout 60] -- <exe> [args...]
// Exit: child's exit code if it exits within --timeout after Ctrl+C; 2 = usage; 3 = never ready; 4 = timeout (killed).
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class WinCtrlCProbe {
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AllocConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
  const uint CTRL_C_EVENT = 0;

  static readonly object Gate = new object();
  static StreamWriter log;
  static string ready = "gateway started";
  static readonly ManualResetEvent ReadySeen = new ManualResetEvent(false);

  static void Emit(string line) {
    lock (Gate) { log.WriteLine(line); log.Flush(); }
    try { Console.Out.WriteLine(line); Console.Out.Flush(); } catch { }
  }

  static void OnLine(string line) {
    if (line == null) return;
    lock (Gate) { log.WriteLine(line); log.Flush(); }
    if (line.Contains(ready)) ReadySeen.Set();
  }

  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
    return "\"" + a.Replace("\\\"", "\\\\\"").Replace("\"", "\\\"") + "\"";
  }

  static int Main(string[] args) {
    string logPath = null; int timeoutSec = 15, readyTimeoutSec = 60; int i = 0;
    for (; i < args.Length; i++) {
      if (args[i] == "--") { i++; break; }
      if (i + 1 >= args.Length) return 2;
      switch (args[i]) {
        case "--log": logPath = args[++i]; break;
        case "--ready": ready = args[++i]; break;
        case "--timeout": timeoutSec = int.Parse(args[++i]); break;
        case "--ready-timeout": readyTimeoutSec = int.Parse(args[++i]); break;
        default: Console.Error.WriteLine("unknown option " + args[i]); return 2;
      }
    }
    if (logPath == null || i >= args.Length) { Console.Error.WriteLine("usage: --log <file> [--ready s] [--timeout n] -- cmd args"); return 2; }
    log = new StreamWriter(logPath, true, new UTF8Encoding(false));

    // A fresh console of our own: the ssh session's console (or lack of one) must not receive the event.
    FreeConsole();
    AllocConsole();
    // IMPORTANT: processes started by Windows OpenSSH inherit the "ignore Ctrl+C" flag
    // (CREATE_NEW_PROCESS_GROUP semantics). Children inherit that flag from us at CreateProcess
    // time, so without clearing it here the child never sees Ctrl+C and the probe reports a
    // false timeout.
    SetConsoleCtrlHandler(IntPtr.Zero, false);

    var psi = new ProcessStartInfo(args[i]) {
      UseShellExecute = false, CreateNoWindow = false,
      RedirectStandardOutput = true, RedirectStandardError = true,
      StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, // node writes UTF-8
    };
    var sb = new StringBuilder();
    for (int j = i + 1; j < args.Length; j++) { if (sb.Length > 0) sb.Append(' '); sb.Append(Quote(args[j])); }
    psi.Arguments = sb.ToString();
    var child = new Process { StartInfo = psi };
    child.OutputDataReceived += (s, e) => OnLine(e.Data);
    child.ErrorDataReceived += (s, e) => OnLine(e.Data);
    child.Start();
    child.BeginOutputReadLine(); child.BeginErrorReadLine();
    Emit("CHILD pid=" + child.Id);

    if (!ReadySeen.WaitOne(readyTimeoutSec * 1000)) {
      Emit("RESULT not ready within " + readyTimeoutSec + "s; killing pid=" + child.Id);
      try { child.Kill(); } catch { }
      return 3;
    }
    // Ignore Ctrl+C ourselves, then broadcast it to every process on this console (group 0).
    SetConsoleCtrlHandler(IntPtr.Zero, true);
    var sw = Stopwatch.StartNew();
    if (!GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)) Emit("WARN GenerateConsoleCtrlEvent failed err=" + Marshal.GetLastWin32Error());
    if (!child.WaitForExit(timeoutSec * 1000)) {
      Emit("RESULT timeout elapsedAfterCtrlC_ms=" + sw.ElapsedMilliseconds + "; force-killing pid=" + child.Id);
      try { child.Kill(); } catch { }
      return 4;
    }
    child.WaitForExit(); // drain redirected output
    Emit("RESULT child exited code=" + child.ExitCode + " elapsedAfterCtrlC_ms=" + sw.ElapsedMilliseconds);
    return child.ExitCode;
  }
}
