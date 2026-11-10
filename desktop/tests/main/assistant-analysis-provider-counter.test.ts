// @vitest-environment node
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync, rmSync, unlinkSync, existsSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapDesktopAssistantAnalysisProvider } from '../../electron/assistant-analysis-provider.js';
import {prepareAssistantAnalysisResources,restoreAssistantAnalysisResources,assistantAnalysisResourcesSupportedPlatform} from '../../electron/assistant-analysis-resources.js';
const scratch:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();for(const root of scratch.splice(0))rmSync(root,{recursive:true,force:true});});

/** No mock counter here: host must explicitly provision the pinned official assets. */
describe('assistant official counter integration',()=>{
  const configured=process.env.ASSISTANT_ANALYSIS_COUNTER_ENV;
  const canUseCounter=!!configured&&assistantAnalysisResourcesSupportedPlatform();
  it.skipIf(!canUseCounter)('bootstraps and measures a configured real provider offline',async()=>{
    const environment=JSON.parse(readFileSync(configured!,'utf8'));
    if(environment.configDir) vi.stubEnv('XIAOK_CONFIG_DIR',environment.configDir);
    let result;
    try {result=await bootstrapDesktopAssistantAnalysisProvider(environment);}
    catch(error) {vi.unstubAllEnvs();throw error;}
    const count=await result.port.measureInput({systemPrompt:'Synthetic calibration only.',userMessage:'Say OK.'});
    expect(Number.isSafeInteger(count)).toBe(true);expect(count).toBe(13);
    expect(result.counterManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.readCurrentModel()).toEqual(result.identity);
    vi.unstubAllEnvs();
    console.log(JSON.stringify({counterManifestSha256:result.counterManifestSha256,inputTokens:count,contract:result.port.contract.id,model:result.port.contract.model}));
  },120_000);
  it.skipIf(!canUseCounter)('prepares pinned official assets and restores them without network',async()=>{
    const options=JSON.parse(readFileSync(configured!,'utf8'));
    if(options.configDir)vi.stubEnv('XIAOK_CONFIG_DIR',options.configDir);
    const input={dataRoot:options.dataRoot,pythonCommand:options.pythonExecutable,modelId:options.modelId};
    const resources=await prepareAssistantAnalysisResources(input);
    const prepared=await bootstrapDesktopAssistantAnalysisProvider({modelId:options.modelId,dataRoot:resources.dataRoot,pythonExecutable:resources.pythonExecutable});
    expect(await prepared.port.measureInput({systemPrompt:'Synthetic calibration only.',userMessage:'Say OK.'})).toBe(13);
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('restore must not download'));
    try{const reused=await restoreAssistantAnalysisResources(input);const restored=await bootstrapDesktopAssistantAnalysisProvider({modelId:options.modelId,dataRoot:reused.dataRoot,pythonExecutable:reused.pythonExecutable});expect(restored.contractHash).toBe(prepared.contractHash);expect(fetch).not.toHaveBeenCalled();}
    finally{fetch.mockRestore();}
    console.log(JSON.stringify({preparedManifest:prepared.counterManifestSha256,contract:prepared.port.contract.id,contractHash:prepared.contractHash,modelId:options.modelId}));
  },120_000);

  const copyResources=()=>{
    const options=JSON.parse(readFileSync(configured!,'utf8'));
    const dataRoot=mkdtempSync(join(tmpdir(),'assistant-counter-recovery-'));scratch.push(dataRoot);
    const managed=join(dataRoot,'assistant-analysis-provider');mkdirSync(managed,{mode:0o700});
    const leaf=join(managed,'recipe-0.1.1');cpSync(join(options.dataRoot,'assistant-analysis-provider','recipe-0.1.1'),leaf,{recursive:true});
    return {options,dataRoot,leaf,input:{dataRoot,pythonCommand:options.pythonExecutable}};
  };
  it.skipIf(!canUseCounter)('only explicit prepare recovers a missing manifest after rename',async()=>{
    const {input,leaf}=copyResources();const manifest=join(leaf,'manifest.json');unlinkSync(manifest);
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('recovery must stay offline'));
    await expect(restoreAssistantAnalysisResources(input)).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');
    expect(existsSync(manifest)).toBe(false);
    const recovered=await prepareAssistantAnalysisResources(input);
    expect(JSON.parse(readFileSync(manifest,'utf8'))).toEqual(recovered.manifest);
    expect(recovered.manifest.tokenizerPath).toBe(join(recovered.dataRoot,'tokenizer.json'));
    expect(recovered.manifest.sitePackages).toBe(join(recovered.dataRoot,'site-packages'));
    expect((await restoreAssistantAnalysisResources(input)).counterManifestSha256).toBe(recovered.counterManifestSha256);
    expect(fetch).not.toHaveBeenCalled();
  },120_000);
  it.skipIf(!canUseCounter)('does not recover an incomplete leaf or overwrite an invalid manifest',async()=>{
    const {input,leaf}=copyResources();const manifest=join(leaf,'manifest.json');
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('must not download'));
    writeFileSync(manifest,'{}');
    await expect(prepareAssistantAnalysisResources(input)).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');expect(readFileSync(manifest,'utf8')).toBe('{}');
    unlinkSync(manifest);unlinkSync(join(leaf,'tokenizer.json'));
    await expect(prepareAssistantAnalysisResources(input)).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');expect(existsSync(manifest)).toBe(false);expect(fetch).not.toHaveBeenCalled();
  },120_000);
  it.skipIf(!canUseCounter)('never replaces a symlink manifest during explicit prepare',async()=>{
    const {input,leaf,dataRoot}=copyResources(),manifest=join(leaf,'manifest.json'),target=join(dataRoot,'protected.txt');
    writeFileSync(target,'protected');unlinkSync(manifest);symlinkSync(target,manifest);
    await expect(prepareAssistantAnalysisResources(input)).rejects.toThrow('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');
    expect(lstatSync(manifest).isSymbolicLink()).toBe(true);expect(readFileSync(target,'utf8')).toBe('protected');
  },120_000);
  it.skipIf(!canUseCounter)('returns the selected configuration modelId rather than its wire model',async()=>{
    const options=JSON.parse(readFileSync(configured!,'utf8')),configDir=mkdtempSync(join(tmpdir(),'assistant-selection-binding-'));scratch.push(configDir);
    writeFileSync(join(configDir,'config.json'),JSON.stringify({schemaVersion:2,defaultModelId:'other-default',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'test-only'}},models:{'other-default':{provider:'deepseek',model:'deepseek-v4-pro'},'p3-explicit-selection':{provider:'deepseek',model:'deepseek-v4-flash-vision-exp'}}}));
    vi.stubEnv('XIAOK_CONFIG_DIR',configDir);
    const result=await bootstrapDesktopAssistantAnalysisProvider({...options,modelId:'p3-explicit-selection'});
    expect(result.modelId).toBe('p3-explicit-selection');expect(result.port.contract.model).toBe('deepseek-v4-flash-vision-exp');
    expect(result.readCurrentModel()).toEqual(result.identity);
  },120_000);

});
