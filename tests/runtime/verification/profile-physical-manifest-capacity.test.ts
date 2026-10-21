import {it,expect,vi} from 'vitest';
import {countBoundedProfileCaptureJson,encodeBoundedProfileCaptureJson} from '../../../src/runtime/verification/profile-capture-json.js';
it('counts and encodes the exact original 128 MiB wire ceiling and rejects one byte less before output allocation',()=>{
 const limit=128*1024**2,value='x'.repeat(limit-2);expect(countBoundedProfileCaptureJson(value,limit)).toBe(limit);
 const alloc=vi.spyOn(Buffer,'alloc');try{expect(()=>encodeBoundedProfileCaptureJson(value,limit-1)).toThrow('manifest_limit');expect(alloc).not.toHaveBeenCalled();}finally{alloc.mockRestore();}
 const bytes=encodeBoundedProfileCaptureJson(value,limit);try{expect(bytes.length).toBe(limit);expect(bytes[0]).toBe(34);expect(bytes[limit-1]).toBe(34);expect(bytes[Math.floor(limit/2)]).toBe(120);}finally{bytes.fill(0);}
},20000);
