import {it,expect,vi} from 'vitest';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
import {encodeBoundedProfileCaptureJson} from '../../../src/runtime/verification/profile-capture-json.js';
it('matches original canonical bytes without building the complete JSON string',()=>{const value={z:[{path:'汉字\\"',size:12},null],a:true};expect(encodeBoundedProfileCaptureJson(value,1024).toString()).toBe(canonicalVerificationJson(value));});
it('rejects full metadata size before allocating the output body',()=>{const alloc=vi.spyOn(Buffer,'alloc');try{expect(()=>encodeBoundedProfileCaptureJson({entries:Array.from({length:1000},()=>({path:'a'.repeat(100)}))},1024)).toThrow('manifest_limit');expect(alloc).not.toHaveBeenCalled();}finally{alloc.mockRestore();}});
