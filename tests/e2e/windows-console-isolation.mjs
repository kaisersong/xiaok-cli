// Native SSH/ConPTY test: imports the actual installed/built bash tool.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.platform, 'win32');
assert.equal(process.stdin.isTTY, true, 'Run in a real Windows terminal');
const root=path.resolve(process.argv[2] ?? '.');
const {bashTool}=await import(pathToFileURL(path.join(root,'dist','ai','tools','bash.js')));
const source=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CP { [DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] list, uint count); }'; $a=New-Object uint32[] 256; $n=[CP]::GetConsoleProcessList($a,256); Write-Output ("CONSOLE_PIDS="+($a[0..([Math]::Max(0,$n-1))] -join ','))`;
const result=await bashTool.execute({command:'powershell -NoProfile -EncodedCommand '+Buffer.from(source,'utf16le').toString('base64')});
const match=result.match(/CONSOLE_PIDS=([\d,]+)/);
assert.ok(match, result);
assert.ok(!match[1].split(',').includes(String(process.pid)), 'Background PowerShell inherited the CLI console: '+match[1]);
console.log('PASS: actual bash PowerShell does not own parent CLI console');
