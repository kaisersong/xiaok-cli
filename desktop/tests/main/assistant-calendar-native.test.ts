import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {verifyYzjCalendarBinary,readYzjCalendarAccount} from '../../electron/assistant-calendar-native.js';
it('rejects a shim/unverified executable before running it',async()=>{const root=mkdtempSync(join(tmpdir(),'assistant-calendar-native-'));try{
 const file=join(root,'yzj-cli');writeFileSync(file,'#!/bin/sh\necho bad');
 await expect(verifyYzjCalendarBinary(file)).rejects.toThrow();
}finally{rmSync(root,{recursive:true,force:true});}});
it('reads only the fixed current-user identity and hashes account identifiers',async()=>{
 let args:readonly string[]=[];
 const account=await readYzjCalendarAccount('/verified/yzj-cli',async(_binary,input)=>{args=input;return {exitCode:0,stdout:JSON.stringify({success:true,identity:'user',data:{orgId:'company',openId:'person'}}),stderr:''};});
 expect(args).toEqual(['--profile','xiaok-assistant','contact','user','get']);expect(account).toMatch(/^[a-f0-9]{64}$/);expect(account).not.toContain('person');
 await expect(readYzjCalendarAccount('/verified/yzj-cli',async()=>({exitCode:0,stdout:JSON.stringify({success:true,identity:'app',data:{orgId:'company',openId:'person'}}),stderr:''}))).rejects.toThrow();
});
it('never starts identity lookup for an already cancelled source read',async()=>{
 let calls=0;const cancellation=new AbortController();cancellation.abort();
 await expect(readYzjCalendarAccount('/verified/yzj-cli',async()=>{calls++;return {exitCode:0,stdout:'',stderr:''};},cancellation.signal)).rejects.toThrow('cancelled');
 expect(calls).toBe(0);
});
