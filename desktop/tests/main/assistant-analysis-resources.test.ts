// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAssistantAnalysisResources, restoreAssistantAnalysisResources, assistantAnalysisResourcesSupportedPlatform } from '../../electron/assistant-analysis-resources.js';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const root=()=>{const p=mkdtempSync(join(tmpdir(),'assistant-resources-test-'));roots.push(p);return p;};
describe('assistant dedicated official resources',()=>{
  it('supports only the reviewed macOS arm64 wheel',()=>{
    expect(assistantAnalysisResourcesSupportedPlatform('darwin','arm64')).toBe(true);
    for(const pair of [['win32','x64'],['linux','arm64'],['darwin','x64']])expect(assistantAnalysisResourcesSupportedPlatform(pair[0],pair[1])).toBe(false);
  });
  it('restore never downloads or creates missing resources',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(restoreAssistantAnalysisResources({dataRoot:root(),pythonCommand:'/missing/python'})).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a symlink managed directory without touching its target',async()=>{
    const dataRoot=root(),target=root();symlinkSync(target,join(dataRoot,'assistant-analysis-provider'),process.platform==='win32'?'junction':'dir');
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(prepareAssistantAnalysisResources({dataRoot,pythonCommand:'/missing/python'})).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects cancelled prepare before network',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(prepareAssistantAnalysisResources({dataRoot:root(),pythonCommand:'/missing/python',signal:AbortSignal.abort()})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it('does not repair or download over a corrupt existing environment',async()=>{
    const dataRoot=root();mkdirSync(join(dataRoot,'assistant-analysis-provider','recipe-0.1.1'),{recursive:true});
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(prepareAssistantAnalysisResources({dataRoot,pythonCommand:'/usr/bin/true'})).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
  });
  it.skipIf(!assistantAnalysisResourcesSupportedPlatform())('rejects a bad official download hash before extraction and cleans staging',async()=>{
    const dataRoot=root(),fetch=vi.fn(async()=>new Response('not-the-official-wheel'));
    vi.stubGlobal('fetch',fetch);
    await expect(prepareAssistantAnalysisResources({dataRoot,pythonCommand:'/usr/bin/true'})).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(1);
    const call=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(call[0]).toContain('https://files.pythonhosted.org/');expect(call[1].redirect).toBe('error');expect(call[1].headers).toBeUndefined();
    const {readdirSync}=await import('node:fs');expect(readdirSync(join(dataRoot,'assistant-analysis-provider'))).toEqual([]);
  });

  it('refuses a missing PATH command without a shell or download',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(prepareAssistantAnalysisResources({dataRoot:root(),pythonCommand:'xiaok-nonexistent-python'})).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
  });

});
