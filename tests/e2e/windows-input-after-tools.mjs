// Drive a/b/c then Enter at each READY marker; assert each FRAME appears before Enter.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.platform,'win32');assert.equal(process.stdin.isTTY,true);
const root=path.resolve(process.argv[2] ?? '.');
const {retainRawInputModeForSession}=await import(pathToFileURL(path.join(root,'dist','ui','input-mode.js')));
const releaseRaw=retainRawInputModeForSession();process.on('exit',releaseRaw);
const {InputReader}=await import(pathToFileURL(path.join(root,'dist','ui','input.js')));
const {bashTool}=await import(pathToFileURL(path.join(root,'dist','ai','tools','bash.js')));
const {probeProcessIdentity}=await import(pathToFileURL(path.join(root,'dist','platform','provider-store','process-identity.js')));
const reader=new InputReader();reader.setScrollPromptRenderer(f=>{console.log('FRAME '+JSON.stringify(f.inputValue));return true});
reader.setTranscriptLogger({record:e=>{if(e.type==='input_key')console.log('KEY '+JSON.stringify(e.key))}});
const commands=[
 'powershell -NoProfile -Command "Get-ComputerInfo | Format-List; Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Id,Name; (Get-ChildItem Env:).Count"',
 'echo alpha beta | findstr /C:"alpha beta"',
 'powershell -NoProfile -Command "Get-Date; Get-ChildItem Env: | Measure-Object"',
];
const timer=setTimeout(()=>{console.error('FAIL input did not return');process.exit(2)},180000);
for(let i=0;i<3;i++){
 const busy=reader.startBusyCapture();
 for(const command of commands)await bashTool.execute({command,max_chars:1000});
 assert.equal(probeProcessIdentity(process.pid).kind,'alive');
 busy.stop();console.log('READY '+i+' (single letter before Enter)');
 const input=await reader.read('> ');assert.equal(input,String.fromCharCode(97+i));console.log('PASS round '+i);
}
clearTimeout(timer);console.log('PASS 3 rounds / 9 tool commands / 3 identity probes');process.exit();
