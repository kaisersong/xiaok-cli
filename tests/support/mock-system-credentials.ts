import {vi} from 'vitest';
// Only test workers use this fake OS boundary. Production uses the selected private file or OS backend.
vi.mock('../../src/utils/system-credentials.js',()=>{const entries=new Map<string,string>();return{systemCredentialBackend:()=>({get:(id:string)=>entries.get(id)??null,put:(id:string,value:string)=>{entries.set(id,value);}})};});
