// @vitest-environment node
import {expect,it} from 'vitest';
const modulePath='../../electron/main-dsh-bootstrap-authority.js';
const api:Record<string,any>=await import(/* @vite-ignore */ modulePath).catch(error=>{if(String(error?.code).includes('MODULE_NOT_FOUND')||String(error?.message).includes('Cannot find module'))return {};throw error;});
it('provides original Main bootstrap factory and private identity reader',()=>{expect(api.createMainDshBootstrapAuthority).toBeTypeOf('function');expect(api.readOriginalMainDshBootstrapAuthority).toBeTypeOf('function');});
it('refuses a plain Node runtime before loading an Electron ABI addon',()=>{expect(api.createMainDshBootstrapAuthority).toBeTypeOf('function');expect(()=>api.createMainDshBootstrapAuthority()).toThrow('DSH_MAIN_NATIVE_UNAVAILABLE');});
it('checks private realm membership before hostile candidate properties',()=>{expect(api.readOriginalMainDshBootstrapAuthority).toBeTypeOf('function');let hits=0;const fake=new Proxy({},{get(){hits++;throw Error('trap');},getPrototypeOf(){hits++;throw Error('trap');}});expect(()=>api.readOriginalMainDshBootstrapAuthority(fake,fake,fake)).toThrow('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED');expect(hits).toBe(0);});
