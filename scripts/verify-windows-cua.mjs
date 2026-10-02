#!/usr/bin/env node
// Runs in an interactive Windows desktop. Only its own disposable test window is captured.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, release } from 'node:os';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('此脚本需要 Windows x64 的交互桌面与 Node.js 24。'); process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const runtime = existsSync(join(here, 'runtime', 'verification-runtime.js'))
  ? new URL('./runtime/verification-runtime.js', import.meta.url)
  : new URL('../artifacts/cua-verification-runtime.js', import.meta.url);
const { installPrivateCuaRelease, WINDOWS_CUA_RELEASE, InvocationToolImages, runDependencyProcess,
  createComputerUseTool, normalizeMcpRuntimeToolResult, CuaConnectionManager, createWindowsCuaBackend,
  isWindowsCuaReplaySafeCall, WINDOWS_CUA_ABI_PROFILE, verifyBackendAbi, detectNativeWindowsArchitecture, detectWindowsInteractiveDesktop, verifyWindowsCuaReadiness } = await import(runtime.href);
const root = join(homedir(), 'Downloads', `xiaok-cua-baseline-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(root, { recursive: true });
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const report = { schemaVersion: 1, platform: process.platform, appArch: process.arch, osRelease: release(), node: process.version,
  release: WINDOWS_CUA_RELEASE, collectedAt: new Date().toISOString(), verified: false };
let gui;
let driver;
let desktopTrace;
const ownedDrivers = [];
const stopOwnedChildren = () => {
  for (const child of [...ownedDrivers, gui, desktopTrace]) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
  }
};
controller.signal.addEventListener('abort', stopOwnedChildren);
try {
  const session = await runDependencyProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ProgressPreference='SilentlyContinue'; (Get-Process -Id ${process.pid}).SessionId`, 'utf16le').toString('base64')],
  { signal: controller.signal, timeoutMs: 20000, maxOutputBytes: 4096 });
  report.sessionProbe = session;
  report.desktopSessionId = Number(session.output);
  if (!session.success || !Number.isInteger(report.desktopSessionId) || report.desktopSessionId <= 0) throw new Error('interactive_desktop_required');
  report.interactiveDesktop = await detectWindowsInteractiveDesktop(controller.signal);
  if (!report.interactiveDesktop) throw new Error('interactive_desktop_production_probe_failed');
  console.log('下载、校验固定官方 release，并安装到本次验证的私有目录…');
  const archivePath = join(here, 'cua-driver-rs-0.31.0-windows-x86_64.zip');
  const binary = await installPrivateCuaRelease(join(root, 'data'), controller.signal, existsSync(archivePath) ? await readFile(archivePath) : undefined);
  report.nativeOsArch = await detectNativeWindowsArchitecture(controller.signal);
  report.authenticodeVerified = true;
  report.runtimeArguments = ['mcp', '--direct'];
  const statePath = join(root, 'test-window-state.json');
  const guiPath = join(root, 'test-window.ps1');
  const title = `Xiaok CUA Verification ${Date.now()}`;
  const ps = `param([string]$StatePath,[string]$Title)
Add-Type -AssemblyName PresentationFramework
$w=New-Object System.Windows.Window; $w.Title=$Title; $w.Width=600; $w.Height=480; $w.Left=50; $w.Top=50; $w.Topmost=$true
$panel=New-Object System.Windows.Controls.StackPanel
$label=New-Object System.Windows.Controls.TextBlock; $label.Text='Xiaok disposable CUA test window'; $panel.Children.Add($label)|Out-Null
$text=New-Object System.Windows.Controls.TextBox; $text.Name='VerificationInput'; $text.Height=40; $panel.Children.Add($text)|Out-Null
[System.Windows.Automation.AutomationProperties]::SetName($text,'VerificationInput')
$button=New-Object System.Windows.Controls.Button; $button.Content='Verification Click'; $button.Height=40; $panel.Children.Add($button)|Out-Null
$script:count=0; $script:doubleClicks=0; $script:rightClicks=0; $script:middleClicks=0
$save={ @{text=$text.Text; clicks=$script:count; pid=$PID; scrollOffset=[double]$scroll.VerticalOffset; selectionStart=$text.SelectionStart; selectionLength=$text.SelectionLength; doubleClicks=$script:doubleClicks; rightClicks=$script:rightClicks; middleClicks=$script:middleClicks} | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8 }
$text.Add_MouseDoubleClick({$script:doubleClicks++; &$save})
$button.Add_PreviewMouseDown({param($sender,$evt) if($evt.ChangedButton.ToString() -eq 'Right'){$script:rightClicks++}; if($evt.ChangedButton.ToString() -eq 'Middle'){$script:middleClicks++}; &$save})
$text.Add_TextChanged($save); $text.Add_SelectionChanged($save); $button.Add_Click({$script:count++; &$save})
$scroll=New-Object System.Windows.Controls.ScrollViewer; $scroll.Height=250
$body=New-Object System.Windows.Controls.TextBlock; $body.Text=((1..100|ForEach-Object{"Verification row $_"}) -join [Environment]::NewLine); $scroll.Content=$body; $panel.Children.Add($scroll)|Out-Null
$scroll.Add_ScrollChanged($save); &$save
$w.Content=$panel; $w.ShowDialog()|Out-Null
`;
  await writeFile(guiPath, ps);
  const electronIndex = process.argv.indexOf('--electron-exe');
  report.fixture = electronIndex >= 0 ? 'electron' : 'wpf';
  if (electronIndex >= 0) {
    const executable = process.argv[electronIndex + 1]; if (!executable || !existsSync(executable)) throw new Error('electron_fixture_executable_missing');
    const mainPath = join(root, 'electron-fixture.cjs'); const preloadPath = join(root, 'electron-preload.cjs'); const htmlPath = join(root, 'electron-fixture.html');
    await writeFile(preloadPath, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('verification',{save:state=>ipcRenderer.send('verification:state',state)});");
    const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${title}</title></head><body style="font:16px sans-serif"><h3>Xiaok disposable CUA test window</h3><input aria-label="VerificationInput" style="width:95%;height:40px"/><button style="width:95%;height:40px">Verification Click</button><textarea aria-label="VerificationScroll" style="width:95%;height:230px">${Array.from({length:100},(_,i)=>'Verification row '+(i+1)).join('\n')}</textarea><script>
      const input=document.querySelector('input'),button=document.querySelector('button'),scroll=document.querySelector('textarea');let clicks=0,doubleClicks=0,rightClicks=0,middleClicks=0;
      function save(){window.verification.save({text:input.value,selectionStart:input.selectionStart,selectionLength:input.selectionEnd-input.selectionStart,scrollOffset:scroll.scrollTop,clicks,doubleClicks,rightClicks,middleClicks})}
      input.addEventListener('input',save);input.addEventListener('select',save);input.addEventListener('keyup',save);input.addEventListener('dblclick',()=>{doubleClicks++;save()});button.addEventListener('click',()=>{clicks++;save()});button.addEventListener('mousedown',e=>{if(e.button===2)rightClicks++;if(e.button===1)middleClicks++;save()});button.addEventListener('auxclick',e=>e.preventDefault());document.addEventListener('contextmenu',e=>e.preventDefault());scroll.addEventListener('scroll',save);document.addEventListener('selectionchange',save);save();
      </script></body></html>`;
    await writeFile(htmlPath, html);
    await writeFile(mainPath, `const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('node:fs');fs.mkdirSync(${JSON.stringify(join(root,'electron-user-data'))},{recursive:true});app.setPath('userData',${JSON.stringify(join(root,'electron-user-data'))});app.commandLine.appendSwitch('force-renderer-accessibility');app.whenReady().then(()=>{const window=new BrowserWindow({title:${JSON.stringify(title)},width:600,height:480,x:50,y:50,webPreferences:{preload:${JSON.stringify(preloadPath)},sandbox:false,contextIsolation:true}});global.verificationWindow=window;window.setAlwaysOnTop(true);window.setMenu(null);window.webContents.once('did-finish-load',()=>{window.show();window.webContents.executeJavaScript('save()')});ipcMain.on('verification:state',(event,state)=>{if(event.sender!==window.webContents)return;fs.writeFileSync(${JSON.stringify(statePath)},JSON.stringify({...state,pid:process.pid,displays:require('electron').screen.getAllDisplays().map(d=>({bounds:d.bounds,scaleFactor:d.scaleFactor})),windowVisible:window.isVisible(),windowMinimized:window.isMinimized(),windowBounds:window.getBounds(),hwnd:Number(window.getNativeWindowHandle().readBigUInt64LE())}));});window.loadFile(${JSON.stringify(htmlPath)});});app.on('window-all-closed',()=>app.quit());`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    gui = spawn(executable, [mainPath], { env, stdio: ['ignore','pipe','pipe'], windowsHide: false });
  } else {
  gui = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', guiPath, statePath, title], { stdio: 'ignore', windowsHide: false });
  }
  let guiLog = ''; const recordGuiLog = chunk => { guiLog = (guiLog + chunk.toString()).slice(-8192); report.guiLog = guiLog; }; gui.stdout?.on('data', recordGuiLog); gui.stderr?.on('data', recordGuiLog);
  await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 4000); gui.once('error', error => { clearTimeout(timer); reject(error); }); });
  if (gui.exitCode !== null) throw new Error('test_window_failed');
  if (report.fixture === 'electron') { const deadline = Date.now() + 20000; let ready = false; while (Date.now() < deadline) { try { ready = JSON.parse(await readFile(statePath,'utf8')).windowVisible === true; } catch {} if (ready) break; await new Promise(resolve => setTimeout(resolve,100)); } if (!ready) throw new Error('electron_fixture_not_ready:'+guiLog); }
  const openDriver = () => {
  const pending = new Map();
  let seq = 0;
  let buffered = '';
  const decoder = new StringDecoder('utf8');
  let stderr = '';
  const currentDriver = spawn(binary, ['mcp', '--direct'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false', CUA_DRIVER_RS_UPDATE_CHECK: 'false',
      CUA_DRIVER_TELEMETRY_HOME: join(root, 'driver-telemetry') } });
  driver = currentDriver; ownedDrivers.push(currentDriver);
  currentDriver.stderr.on('data', chunk => { if (stderr.length < 16384) stderr += String(chunk).slice(0, 16384 - stderr.length); });
  currentDriver.stdout.on('data', chunk => {
    buffered += decoder.write(chunk);
    if (buffered.length > 24 * 1024 * 1024) { currentDriver.kill(); return; }
    while (buffered.includes('\n')) {
      const end = buffered.indexOf('\n'); const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      try { const value = JSON.parse(line); const entry = pending.get(value.id); if (entry) { pending.delete(value.id); clearTimeout(entry.timer); value.error ? entry.reject(new Error(JSON.stringify(value.error))) : entry.resolve(value.result); } } catch { /* non-protocol stdout is never evidence */ }
    }
  });
  currentDriver.once('error', error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); });
  currentDriver.stdin.on('error', error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); });
  currentDriver.once('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Transport closed')); } pending.clear(); });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (currentDriver.exitCode !== null || currentDriver.signalCode !== null) { reject(new Error('Transport closed')); return; }
    if (controller.signal.aborted) { reject(new Error('baseline_cancelled')); return; }
    const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`rpc_timeout:${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer }); currentDriver.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
    return { request, child: currentDriver };
  };
  let transport = openDriver();
  const request = (method, params) => transport.request(method, params);
  report.initialize = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'xiaok-cua-baseline', version: '1' } });
  if (report.initialize.serverInfo?.name !== 'cua-driver' || report.initialize.serverInfo?.version !== WINDOWS_CUA_RELEASE.version) throw new Error('runtime_identity_mismatch');
  driver.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const catalog = await request('tools/list', {});
  await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2));
  report.catalogSha256 = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  report.abi = verifyBackendAbi(catalog.tools.map(t => ({name:t.name, required:t.inputSchema.required ?? [], properties:t.inputSchema.properties ?? {}})), WINDOWS_CUA_ABI_PROFILE);
  if (!report.abi.ok) throw new Error('windows_abi_mismatch');
  const windows = await request('tools/call', { name: 'list_windows', arguments: { pid: gui.pid, on_screen_only: true } });
  await writeFile(join(root, 'list-windows.json'), JSON.stringify(windows, null, 2));
  const structured = windows.structuredContent;
  const candidates = structured?.windows ?? structured?.result?.windows;
  if (!Array.isArray(candidates)) throw new Error('window_envelope_unknown');
  const matches = candidates.filter(w => w.pid === gui.pid && (w.title === title || w.window_title === title));
  if (matches.length !== 1) { report.testWindowState = JSON.parse((await readFile(statePath, 'utf8')).replace(/^\uFEFF/, '')); report.allOwnedWindows = await request('tools/call', { name: 'list_windows', arguments: { pid: gui.pid } }); throw new Error('test_window_ambiguous_or_missing'); }
  const target = { pid: gui.pid, window_id: matches[0].window_id };
  // Read-only native facts in the same interactive session; no focus or cursor mutation.
  const tracePath = join(root, 'desktop-input-trace.jsonl');
  const traceSource = "$ProgressPreference='SilentlyContinue'\nAdd-Type @'\nusing System; using System.Runtime.InteropServices;\npublic class CuaOwnTrace {\n [StructLayout(LayoutKind.Sequential)] public struct POINT {public int x; public int y;}\n [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n [DllImport(\"user32.dll\")] public static extern bool GetCursorPos(out POINT p);\n [DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int n);\n [DllImport(\"user32.dll\")] public static extern IntPtr GetWindowLongPtrW(IntPtr h,int n);\n [DllImport(\"user32.dll\")] public static extern IntPtr WindowFromPoint(POINT p);\n [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);\n [DllImport(\"user32.dll\")] public static extern bool IsWindowEnabled(IntPtr h);\n [DllImport(\"user32.dll\",CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h,System.Text.StringBuilder b,int n);\n [DllImport(\"dwmapi.dll\")] public static extern int DwmGetWindowAttribute(IntPtr h,int a,out int value,int size);\n [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);\n}\n'@\nfor($i=0;$i -lt 180;$i++) {\n $fg=[CuaOwnTrace]::GetForegroundWindow();[uint32]$fgpid=0;[void][CuaOwnTrace]::GetWindowThreadProcessId($fg,[ref]$fgpid)\n $point=New-Object CuaOwnTrace+POINT;$cursorOk=[CuaOwnTrace]::GetCursorPos([ref]$point)\n $cursorWindow=[CuaOwnTrace]::WindowFromPoint($point);[uint32]$cursorPid=0;[void][CuaOwnTrace]::GetWindowThreadProcessId($cursorWindow,[ref]$cursorPid);$class=New-Object System.Text.StringBuilder 256;[void][CuaOwnTrace]::GetClassNameW($cursorWindow,$class,256);[int]$cloaked=0;$cloakedResult=[CuaOwnTrace]::DwmGetWindowAttribute([IntPtr]__HWND__,14,[ref]$cloaked,4)\n @{time=[DateTime]::UtcNow.ToString('o');foreground=[long]$fg;foregroundPid=$fgpid;cursorOk=$cursorOk;x=$point.x;y=$point.y;virtualX=[CuaOwnTrace]::GetSystemMetrics(76);virtualY=[CuaOwnTrace]::GetSystemMetrics(77);virtualWidth=[CuaOwnTrace]::GetSystemMetrics(78);virtualHeight=[CuaOwnTrace]::GetSystemMetrics(79);sessionId=(Get-Process -Id $PID).SessionId;targetVisible=[CuaOwnTrace]::IsWindowVisible([IntPtr]__HWND__);targetEnabled=[CuaOwnTrace]::IsWindowEnabled([IntPtr]__HWND__);targetExStyle=[long][CuaOwnTrace]::GetWindowLongPtrW([IntPtr]__HWND__,-20);cursorWindow=[long]$cursorWindow;cursorPid=$cursorPid;cursorClass=$class.ToString();targetCloaked=$cloaked;cloakedResult=$cloakedResult}|ConvertTo-Json -Compress|Add-Content -Encoding UTF8 -LiteralPath '__TRACE_PATH__'\n Start-Sleep -Milliseconds 250\n}\n".replaceAll('__HWND__', String(target.window_id)).replace('__TRACE_PATH__', tracePath.replaceAll("'", "''"));
  desktopTrace = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(traceSource,'utf16le').toString('base64')], { stdio:['ignore','ignore','pipe'], windowsHide:true });
  desktopTrace.stderr.on('data', chunk => { report.desktopTraceError = ((report.desktopTraceError ?? '') + chunk.toString()).slice(-8192); });
  report.desktopReadiness = await verifyWindowsCuaReadiness({ identity: report.initialize.serverInfo, schemas: catalog.tools, callToolResult: async (name, input) => normalizeMcpRuntimeToolResult(await request('tools/call', { name, arguments: input })), target });
  const observation = await request('tools/call', { name: 'get_window_state', arguments: { ...target, include_screenshot: true, max_depth: 10, max_elements: 100 } });
  await writeFile(join(root, 'capture.json'), JSON.stringify(observation, null, 2));
  if (observation.isError || !observation.content?.some(b => b.type === 'image' && b.data?.length)) throw new Error('test_capture_failed');
  if (observation.structuredContent?.pid !== target.pid || observation.structuredContent?.window_id !== target.window_id) throw new Error('capture_target_mismatch');
  const images = new InvocationToolImages(controller.signal, true);
  for (const block of observation.content.filter(b => b.type === 'image')) {
    images.emit({ type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } });
  }
  report.validatedImages = images.finish(true).length;
  report.testTarget = target;
  report.testWindowState = JSON.parse((await readFile(statePath, 'utf8')).replace(/^\uFEFF/, ''));
  // Completing this probe proves observation only. Mutation/DPI/RDP acceptance remains separate.
  report.observationPassed = true;
  if (process.argv.includes('--actions')) {
    report.wrapperActions = [];
    const connectionFor = owned => ({
      callToolResult: async (name, input) => {
        const raw = await owned.request('tools/call', { name, arguments: input });
        if (raw.isError) { report.nativeErrors ??= []; report.nativeErrors.push({ name, input, result: raw }); }
        return normalizeMcpRuntimeToolResult(raw);
      },
      dispose: async () => {
        if (owned.child.exitCode !== null || owned.child.signalCode !== null) return;
        const exited = new Promise(resolve => owned.child.once('close', (code, signal) => resolve({code, signal})));
        owned.child.stdin.end(); const timer = setTimeout(() => owned.child.kill(), 10000);
        const outcome = await exited; clearTimeout(timer); report.driverClosures ??= []; report.driverClosures.push(outcome);
      },
    });
    const connection = connectionFor(transport);
    const manager = new CuaConnectionManager(async () => {
      const replacement = openDriver();
      try {
        const identity = await replacement.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'xiaok-cua-baseline', version: '1' } });
        replacement.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const schema = await replacement.request('tools/list', {});
        const candidate = connectionFor(replacement);
        const readiness = await verifyWindowsCuaReadiness({ identity: identity.serverInfo, schemas: schema.tools, callToolResult: candidate.callToolResult, target });
        transport = replacement; report.transportReplacement = { identity: identity.serverInfo, readiness, pid: replacement.child.pid };
        return candidate;
      } catch (error) { await connectionFor(replacement).dispose(); throw error; }
    }, { initialConnection: connection, isReplaySafeCall: isWindowsCuaReplaySafeCall });
    const tool = createComputerUseTool(createWindowsCuaBackend(manager), WINDOWS_CUA_ABI_PROFILE);
    const run = async (input, allowFailure = false) => {
      const port = new InvocationToolImages(controller.signal, true);
      try {
        const output = await tool.execute(input, { signal: controller.signal, modelSupportsImageInput: true, emitToolImage: port.emit });
        let result; try { result = JSON.parse(output); } catch { throw new Error(`wrapper_non_json:${output}`); }
        const imageCount = port.finish(result.ok === true).length;
        report.wrapperActions.push({ input, result, imageCount });
        if (!result.ok && !allowFailure) throw new Error(`wrapper_action_failed:${JSON.stringify(result)}`);
        return { result, imageCount };
      } catch (error) { port.finish(false); throw error; }
    };
    const state = async () => JSON.parse((await readFile(statePath, 'utf8')).replace(/^\uFEFF/, ''));
    const capture = async () => (await run({ action: 'capture', ...target, timeout_ms: 5000 })).result.result.structuredContent;
    const token = (capture, label) => { const found = capture.elements.filter(e => e.label === label); if (found.length !== 1) throw new Error(`test_element_missing:${label}`); return found[0].element_token; };
    const retryForeground = async (build, captureOptions = {}, allowForegroundFailure = false) => {
      const observe = async () => (await run({ action: 'capture', ...target, timeout_ms: 5000, ...captureOptions })).result.result.structuredContent;
      let current = await observe(); let action = build(current);
      const first = await run(action, true);
      if (first.result.ok) return first;
      if (first.result.code !== 'COMPUTER_USE_BACKGROUND_UNAVAILABLE') throw new Error(`unexpected_action_refusal:${JSON.stringify(first.result)}`);
      await new Promise(resolve => setTimeout(resolve, 4200));
      current = await observe(); action = build(current);
      return run({ ...action, delivery_mode: 'foreground' }, allowForegroundFailure);
    };
    report.actions = {};
    let view = await capture();
    await retryForeground(current => ({ action: 'set_value', ...target, element_token: token(current, 'VerificationInput'), value: 'xiaok_中文验证', capture_after: true }));
    report.actions.setValue = await state();
    if (report.actions.setValue.text !== 'xiaok_中文验证') throw new Error('set_value_readback_failed');
    view = await capture();
    await retryForeground(current => ({ action: 'type', ...target, element_token: token(current, 'VerificationInput'), text: '_输入', capture_after: true }));
    report.actions.type = await state();
    if (!report.actions.type.text.includes('_输入')) throw new Error('type_readback_failed');
    view = await capture();
    const keyBackground = await run({ action: 'key', ...target, element_token: token(view, 'VerificationInput'), key: 'end', capture_after: true }, true);
    if (!keyBackground.result.ok) {
      if (keyBackground.result.code !== 'COMPUTER_USE_BACKGROUND_UNAVAILABLE') throw new Error('key_unexpected_refusal');
      view = await capture();
      await run({ action: 'key', ...target, element_token: token(view, 'VerificationInput'), key: 'end', delivery_mode: 'foreground', capture_after: true });
    }
    report.actions.key = await state();
    if (report.actions.key.selectionStart !== report.actions.key.text.length) throw new Error('key_readback_failed');
    view = await capture();
    await run({ action: 'click', ...target, element_token: token(view, 'Verification Click'), capture_after: true });
    report.actions.click = await state();
    if (report.actions.click.clicks !== 1) throw new Error('click_readback_failed');
    view = await capture();
    const pane = view.elements.find(e => (e.label === 'VerificationScroll' || e.role === 'Pane') && e.actions.includes('scroll'));
    if (!pane) throw new Error('test_scroll_pane_missing');
    await retryForeground(current => { const currentPane = current.elements.find(e => (e.label === 'VerificationScroll' || e.role === 'Pane') && e.actions.includes('scroll')); return { action: 'scroll', ...target, element_token: currentPane.element_token, direction: 'down', pages: 1, by: 'page', capture_after: true }; });
    report.actions.scroll = await state();
    if (!(report.actions.scroll.scrollOffset > 0)) throw new Error('scroll_readback_failed');
    view = (await run({ action: 'capture', ...target, max_dimension: 300, timeout_ms: 5000 })).result.result.structuredContent;
    const pixelButton = view.elements.find(e => e.label === 'Verification Click').screenshot_frame;
    await run({ action: 'click', ...target, capture_id: view.capture_id, x: pixelButton.x + pixelButton.w/2, y: pixelButton.y + pixelButton.h/2, capture_after: true });
    report.actions.scaledPixelClick = await state();
    if (report.actions.scaledPixelClick.clicks !== 2 || !(view.screenshot_width <= 300)) throw new Error('scaled_pixel_readback_failed');
    report.errorGoldens = {};
    report.errorGoldens.wrongPid = await request('tools/call', { name: 'get_window_state', arguments: { pid: process.pid, window_id: target.window_id, include_screenshot: true } });
    await writeFile(join(root, 'wrong-pid.json'), JSON.stringify(report.errorGoldens.wrongPid, null, 2));
    if (!report.errorGoldens.wrongPid.isError) throw new Error('wrong_pid_not_refused');
    await request('tools/call', { name: 'end_session', arguments: {} });
    report.errorGoldens.endedSession = await request('tools/call', { name: 'get_window_state', arguments: { ...target, include_screenshot: true } });
    await writeFile(join(root, 'ended-session.json'), JSON.stringify(report.errorGoldens.endedSession, null, 2));
    if (!report.errorGoldens.endedSession.isError) throw new Error('ended_session_not_refused');
    const recoveryPort = new InvocationToolImages(controller.signal, true);
    const recovery = JSON.parse(await tool.execute({ action: 'capture', ...target }, { signal: controller.signal, modelSupportsImageInput: true, emitToolImage: recoveryPort.emit }));
    report.sessionRecovery = { result: recovery, images: recoveryPort.finish(false).length };
    if (recovery.code !== 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED' || report.sessionRecovery.images !== 0) throw new Error('session_recovery_did_not_require_reobserve');
    await capture();
    view = await capture();
    const stale = token(view, 'Verification Click'); const beforeReplacement = await state();
    const closedTransport = new Promise(resolve => driver.once('close', resolve)); driver.kill(); await closedTransport;
    const interrupted = await run({ action: 'click', ...target, element_token: stale }, true);
    if (interrupted.result.code !== 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED' || interrupted.imageCount !== 0) throw new Error('transport_mutation_recovery_failed');
    await capture(); const afterReplacement = await state();
    if (afterReplacement.clicks !== beforeReplacement.clicks) throw new Error('transport_replayed_mutation');
    const staleAction = await run({ action: 'click', ...target, element_token: stale }, true);
    if (staleAction.result.code !== 'COMPUTER_USE_REOBSERVE_REQUIRED') throw new Error('replacement_accepted_stale_token');
    report.transportReplacement.mutationNotReplayed = true;
    report.coreActionsPassed = true;
    report.gestures = {};
    const gesture = async (name, build, check) => {
      try {
        const attempt = await retryForeground(build, {}, true); const observed = await state(); report.actions[name] = observed;
        report.gestures[name] = { ok: attempt.result.ok === true && check(observed), result: attempt.result, imageCount: attempt.imageCount };
      } catch (error) { report.gestures[name] = { ok: false, error: error.message }; }
    };
    await gesture('doubleClick', current => ({ action: 'double_click', ...target, element_token: token(current, 'VerificationInput'), capture_after: true }), observed => observed.doubleClicks > 0);
    await gesture('rightClick', current => ({ action: 'right_click', ...target, element_token: token(current, 'Verification Click'), capture_after: true }), observed => observed.rightClicks > 0);
    await gesture('middleClick', current => ({ action: 'middle_click', ...target, element_token: token(current, 'Verification Click'), capture_after: true }), observed => observed.middleClicks > 0);
    await gesture('drag', current => {
      const frame = current.elements.find(e => e.label === 'VerificationInput').screenshot_frame;
      return { action: 'drag', ...target, x: frame.x + 5, y: frame.y + frame.h / 2, to_x: frame.x + 180, to_y: frame.y + frame.h / 2, duration_ms: 300, steps: 12, capture_after: true };
    }, observed => observed.selectionLength > 0);
    report.actionsPassed = Object.values(report.gestures).every(result => result.ok);
    await manager.dispose();
  }
  if (driver.exitCode !== null || driver.signalCode !== null) report.stdinEofExit = { code: driver.exitCode, signal: driver.signalCode };
  else {
    const closed = new Promise(resolve => driver.once('close', (code, signal) => resolve({ code, signal })));
    driver.stdin.end(); const eofTimeout = setTimeout(() => driver.kill(), 10000);
    report.stdinEofExit = await closed; clearTimeout(eofTimeout);
  }
  if (report.stdinEofExit.code !== 0) throw new Error('stdin_eof_shutdown_failed');
  report.verified = !process.argv.includes('--actions') || report.actionsPassed === true;
  if (!report.verified) { report.error = 'gesture_acceptance_failed'; process.exitCode = 1; }
  console.log(`${report.verified ? '验收通过' : '验收未通过'}；报告已保存：${root}`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(`基线未通过：${report.error}\n报告目录：${root}`);
  process.exitCode = 1;
} finally {
  const closed = [...ownedDrivers, gui, desktopTrace].filter(child => child && child.exitCode === null && child.signalCode === null)
    .map(child => new Promise(resolve => child.once('close', resolve)));
  controller.abort();
  await Promise.all(closed);
  controller.signal.removeEventListener('abort', stopOwnedChildren);
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
}
