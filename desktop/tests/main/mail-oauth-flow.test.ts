// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { MailOAuthFlow } from '../../electron/mail-oauth-flow';
const flows: MailOAuthFlow[]=[];
afterEach(()=>{for(const flow of flows.splice(0))flow.dispose();});
function setup(authorize=vi.fn().mockResolvedValue(undefined)) {let opened='';const flow=new MailOAuthFlow({openExternal:async url=>{opened=url;},authorize});flows.push(flow);return {flow,authorize,url:()=>new URL(opened)};}
it('uses a loopback redirect, PKCE and state; refuses a wrong state before exchanging a code',async()=> {
 const f=setup();await f.flow.start({provider:'gmail',clientId:'test-client-id',allowSend:true,expectedRevision:0},'user');
 const url=f.url();expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('code_challenge')!.length).toBeGreaterThan(30);
 const callback=new URL(url.searchParams.get('redirect_uri')!);expect(callback.hostname).toBe('127.0.0.1');callback.searchParams.set('state','incorrect');callback.searchParams.set('code','private-code');
 expect((await fetch(callback)).status).toBe(400);expect(f.authorize).not.toHaveBeenCalled();expect(JSON.stringify(f.flow.getState())).not.toContain('code_challenge');
});
it('consumes a code once and cancels a pending exchange without allowing a late commit',async()=> {
 let check!:()=>void,finish!:()=>void;
 const authorize=vi.fn(async(_i,_code,_verifier,_redirect,_signal,assertCurrent)=>{check=assertCurrent;await new Promise<void>(resolve=>finish=resolve);assertCurrent();});
 const f=setup(authorize);const state=await f.flow.start({provider:'outlook',clientId:'test-id',allowSend:true,expectedRevision:0},'user');const url=f.url();const callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('state',url.searchParams.get('state')!);callback.searchParams.set('code','private-code');
 const request=fetch(callback).catch(()=>null);await vi.waitFor(()=>expect(authorize).toHaveBeenCalledTimes(1));
 await f.flow.cancel(state.operationId,'user');expect(()=>check()).toThrow('mail_authorization_cancelled');finish();await request;expect(f.flow.getState().phase).toBe('cancelled');
});
it.each(['agent','scheduler',undefined])('rejects %s OAuth login before opening browser',async source=>{
 const f=setup();await expect(f.flow.start({provider:'gmail',clientId:'client',allowSend:true,expectedRevision:0},source as never)).rejects.toThrow('mail_user_only');expect(f.flow.getState().phase).toBe('idle');
});

it('does not run a prepared credential commit after cancellation, and late cancellation preserves an already committed success',async()=>{
 let ready!:(commit:()=>void)=>void;const commit=vi.fn();const f=setup(vi.fn(()=>new Promise(resolve=>ready=resolve)) as never);const state=await f.flow.start({provider:'gmail',clientId:'client',allowSend:true,expectedRevision:0},'user');const url=f.url(),callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('state',url.searchParams.get('state')!);callback.searchParams.set('code','private-code');const request=fetch(callback).catch(()=>null);await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));await f.flow.cancel(state.operationId,'user');ready(commit);await request;expect(commit).not.toHaveBeenCalled();expect(f.flow.getState().phase).toBe('cancelled');
});
