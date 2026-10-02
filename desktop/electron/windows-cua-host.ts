import { runDependencyProcess } from './dependency-task.js';

/** GetNativeSystemInfo, not Node's libuv GetSystemInfo or editable environment variables. */
export async function detectNativeWindowsArchitecture(signal?: AbortSignal): Promise<'x64' | 'arm64' | 'unsupported'> {
  if (process.platform !== 'win32' || process.arch !== 'x64') return 'unsupported';
  const script = `$ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class XiaokNativeArchitecture { [DllImport("kernel32.dll")] static extern void GetNativeSystemInfo(IntPtr p); public static int Read() { IntPtr p=Marshal.AllocHGlobal(64); try { GetNativeSystemInfo(p); return (int)(ushort)Marshal.ReadInt16(p); } finally { Marshal.FreeHGlobal(p); } } }'; [XiaokNativeArchitecture]::Read()`;
  const result = await runDependencyProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { signal, timeoutMs: 20_000, maxOutputBytes: 4096 });
  if (!result.success) return 'unsupported';
  return result.output === '9' ? 'x64' : result.output === '12' ? 'arm64' : 'unsupported';
}

/** Session 0 / a locked or secure input desktop cannot be operated by this process. */
export async function detectWindowsInteractiveDesktop(signal?: AbortSignal): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const script = `$ProgressPreference='SilentlyContinue'; if ((Get-Process -Id $PID).SessionId -le 0) { Write-Output 'unavailable'; exit }; Add-Type -TypeDefinition 'using System; using System.Text; using System.Diagnostics; using System.Runtime.InteropServices; public static class XiaokInputDesktop {
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint f, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr p);
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint length, out uint needed);
    [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode)] static extern bool WTSQuerySessionInformationW(IntPtr server, int session, int info, out IntPtr value, out int bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr value);
    static string Name(IntPtr handle) { var value=new StringBuilder(256); uint needed; return GetUserObjectInformationW(handle,2,value,512,out needed) ? value.ToString() : ""; }
    public static bool Available() { IntPtr state; int bytes; if(!WTSQuerySessionInformationW(IntPtr.Zero,Process.GetCurrentProcess().SessionId,8,out state,out bytes)) return false;
      try { if(bytes<4 || Marshal.ReadInt32(state)!=0) return false; } finally { WTSFreeMemory(state); }
      if(!String.Equals(Name(GetProcessWindowStation()),"WinSta0",StringComparison.OrdinalIgnoreCase)) return false;
      IntPtr desktop=OpenInputDesktop(0,false,0x0001); if(desktop==IntPtr.Zero) return false;
      try { return String.Equals(Name(desktop),"Default",StringComparison.OrdinalIgnoreCase); } finally { CloseDesktop(desktop); }
    }
  }'; if ([XiaokInputDesktop]::Available()) { Write-Output 'available' } else { Write-Output 'unavailable' }`;
  const result = await runDependencyProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { signal, timeoutMs: 20_000, maxOutputBytes: 4096 });
  return result.success && result.output === 'available';
}
