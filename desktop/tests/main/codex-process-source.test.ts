import { describe, it, expect } from 'vitest';
import { createOriginalCodexProcessSourceTicket, readOptionalOriginalCodexProcessSourceRequest } from '../../electron/codex-process-source.js';
import { readOriginalCodexProcessSession } from '../../electron/codex-native-service.js';
import { readOriginalCodexProcessLaunch, SessionProbe, resolveLaunch } from '../../electron/codex-native-transport.js';

describe('original Codex process source membership', () => {
  it('rejects foreign and copied shapes without invoking getters or Proxy traps', () => {
    let hits=0;
    const foreign=Object.defineProperty({},'context',{get(){hits++;throw Error('getter');}});
    const proxy=new Proxy({}, {get(){hits++;throw Error('proxy');},ownKeys(){hits++;throw Error('keys');}});
    for(const input of [foreign,proxy,null,undefined,3]) {
      expect(readOptionalOriginalCodexProcessSourceRequest(input)).toBeUndefined();
      expect(()=>readOriginalCodexProcessSession(input)).toThrow('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
      expect(()=>readOriginalCodexProcessLaunch(input)).toThrow('CODEX_PROCESS_ORIGINAL_LAUNCH_REQUIRED');
    }
    expect(()=>createOriginalCodexProcessSourceTicket(foreign)).toThrow('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
    expect(hits).toBe(0);
  });
  it('an ordinary public probe cannot mint a qualified Source ticket', () => {
    const probe=new SessionProbe({executable:process.execPath,cwd:process.cwd()});
    expect(()=>createOriginalCodexProcessSourceTicket(probe)).toThrow('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
    expect(probe.pid).toBeUndefined();
  });
  it('keeps the original Windows shim rejection and actual JS launch contract', () => {
    expect(()=>resolveLaunch('C:\\tools\\codex.cmd',[],'win32')).toThrow(/shim/);
    expect(()=>resolveLaunch('C:\\tools\\codex.bat',[],'win32')).toThrow(/shim/);
    expect(resolveLaunch('C:\\tools\\codex.exe',['app-server'],'win32')).toEqual({command:'C:\\tools\\codex.exe',args:['app-server']});
    expect(resolveLaunch('C:\\tools\\codex.js',['app-server'],'win32')).toEqual({command:process.execPath,args:['C:\\tools\\codex.js','app-server']});
  });
});
