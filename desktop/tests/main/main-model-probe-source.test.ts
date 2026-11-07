// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('electron',()=>{const BrowserWindow=Object.assign(function BrowserWindow(){},{getAllWindows(){return[];},fromId(){return null;},fromWebContents(){return null;}});const api={app:{isReady(){return false;}},BrowserWindow,webContents:{fromId(){return null;}}};return{default:api,...api};});
const modulePath='../../electron/main-model-probe-source.js';
const api:Record<string,any>=await import(/* @vite-ignore */modulePath).catch(error=>{if(String(error?.code).includes('MODULE_NOT_FOUND')||String(error?.message).includes('Cannot find module'))return{};throw error;});
it('exports private original Main model probe context producer and fixed resource reader',()=>{expect(api.createOriginalMainModelProbeContext).toBeTypeOf('function');expect(api.readOriginalMainModelProbeResourceContext).toBeTypeOf('function');});
it('foreign refs and copied context shapes never become resource context or execute a getter',()=>{
 expect(api.createOriginalMainModelProbeContext).toBeTypeOf('function');let hits=0;const foreign=new Proxy({}, {get(){hits++;throw Error();},getOwnPropertyDescriptor(){hits++;throw Error();},getPrototypeOf(){hits++;throw Error();}});
 expect(()=>api.createOriginalMainModelProbeContext(foreign,foreign,foreign,foreign)).toThrow();expect(api.readOriginalMainModelProbeResourceContext(foreign,foreign,foreign)).toBeNull();expect(api.readOriginalMainModelProbeResourceContext({scope:{},executionClass:'admission_probe'},foreign,foreign)).toBeNull();expect(hits).toBe(0);
});
