import {assertOriginalSupervisorImplementationContext} from './source-supervisor.js';
import { readWindowsProcessBirth } from '../windows-owner-security.js';
import { execFile } from 'node:child_process';
import type { processBirthContext } from './source-supervisor.js';
export function readProcessBirth(pid: number, timeoutMs: number, context:processBirthContext): Promise<string> {
 assertOriginalSupervisorImplementationContext(context,'process');
 const {BIRTH_LOOKUP_TIMEOUT_MS}=context;
  if(process.platform==='win32'&&process.arch==='x64'){
    try{return Promise.resolve(readWindowsProcessBirth(pid));}
    catch(cause){return Promise.reject(new Error('activity_source_birth_unavailable',{cause}));}
  }
  return new Promise((resolve, reject) => {
    const args = process.platform === 'win32'
      ? ['-NoProfile','-NonInteractive','-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]
      : ['-p', String(pid), '-o', 'lstart='];
    execFile(process.platform === 'win32' ? 'powershell.exe' : '/bin/ps', args, { timeout: timeoutMs }, (error, stdout) => {
      if (error || !stdout.trim()) reject(new Error('activity_source_birth_unavailable')); else resolve(stdout.trim());
    });
  });
}
