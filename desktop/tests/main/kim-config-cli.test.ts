// @vitest-environment node
import {Command} from 'commander';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {DEFAULT_CONFIG} from '../../../src/types.js';
const store=vi.hoisted(()=>({value:{} as any,save:vi.fn()}));
vi.mock('../../../src/utils/config.js',()=>({loadConfig:async()=>structuredClone(store.value),saveConfig:async c=>{store.save(c);store.value=structuredClone(c);}}));
import {registerConfigCommands} from '../../../src/commands/config.js';
beforeEach(()=>{store.value=structuredClone(DEFAULT_CONFIG);store.save.mockReset();vi.spyOn(console,'log').mockImplementation(()=>{});});afterEach(()=>vi.restoreAllMocks());
function run(args:string[]){const c=new Command();registerConfigCommands(c);return c.parseAsync(['node','xiaok','config','set',...args]);}
it('enables the dedicated model via the real CLI command while preserving chat selection',async()=>{const original=store.value.defaultModelId;await run(['kim-base-url','http://localhost:8765']);await run(['kim-enabled','true']);expect(store.value.kimDecision).toMatchObject({enabled:true,baseUrl:'http://127.0.0.1:8765',attentionThreshold:0.65});expect(store.value.kimDecision.revision).toMatch(/^[a-f0-9-]{36}$/);expect(store.value.defaultModelId).toBe(original);});
it.each([['kim-enabled','yes'],['kim-base-url','http://remote.invalid']])('refuses invalid CLI settings before save: %s',async(key,value)=>{await expect(run([key,value])).rejects.toThrow();expect(store.save).not.toHaveBeenCalled();});
