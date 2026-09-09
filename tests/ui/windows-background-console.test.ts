import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('node:fs',()=>({readFileSync:vi.fn(()=>{throw new Error('fixture has no image')}),unlinkSync:vi.fn(),writeFileSync:vi.fn()}));
vi.mock('node:child_process',()=>({spawnSync:vi.fn(),execSync:vi.fn()}));
const cp=await import('node:child_process');
const {probeProcessIdentity}=await import('../../src/platform/provider-store/process-identity.js');
const {hasImageInClipboard,getImageFromClipboard}=await import('../../src/utils/clipboard.js');
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
afterEach(()=>{Object.defineProperty(process,'platform',platform);vi.clearAllMocks()});
describe('Windows background console ownership',()=>{
 it('identity probe cannot inherit interactive console',()=>{
  Object.defineProperty(process,'platform',{...platform,value:'win32'});
  vi.mocked(cp.spawnSync).mockReturnValue({status:0,stdout:'start-token'} as never);
  expect(probeProcessIdentity(123).kind).toBe('alive');
  expect(cp.spawnSync).toHaveBeenCalledWith('powershell.exe',expect.any(Array),expect.objectContaining({windowsHide:true}));
 });
 it('clipboard detection and saving cannot inherit interactive console',()=>{
  Object.defineProperty(process,'platform',{...platform,value:'win32'});
  vi.mocked(cp.execSync).mockReturnValue('True' as never);
  hasImageInClipboard();getImageFromClipboard();
  expect(cp.execSync).toHaveBeenCalledTimes(3);
  for(const [,options]of vi.mocked(cp.execSync).mock.calls)expect(options).toMatchObject({windowsHide:true});
 });
});
