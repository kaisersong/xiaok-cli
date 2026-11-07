// @vitest-environment node
import {it,expect} from 'vitest';
import {createInitialPlanOwnerClient,readPlanningOwnerResponse} from '../../electron/kswarm-initial-plan-owner-client.js';
it('the original unread planning body is cancelled and joined on admission failure, retaining the exact control cause',async()=>{
 const control=Error('original actor revoked'),cancelled:unknown[]=[];const response=new Response(new ReadableStream({cancel(reason){cancelled.push(reason);}}));let error:unknown;
 try{await readPlanningOwnerResponse(response,()=>{throw control;});}catch(failure){error=failure;}
 expect(error).toBe(control);expect(cancelled.length).toBe(1);expect(cancelled[0]).toBe(control);
});
it('a planning body cancellation error cannot replace the admission cause or be silently released',async()=>{
 const control=Error('original actor revoked'),cleanup=Error('original body close unknown'),response=new Response(new ReadableStream({cancel(){throw cleanup;}}));let error:unknown;
 try{await readPlanningOwnerResponse(response,()=>{throw control;});}catch(failure){error=failure;}
 expect(error).toBeInstanceOf(AggregateError);const aggregate=error as AggregateError;expect(aggregate.cause).toBe(control);expect(Array.isArray(aggregate.errors)).toBe(true);expect(aggregate.errors.length).toBe(2);expect(aggregate.errors[0]).toBe(control);expect(aggregate.errors[1]).toBe(cleanup);
});
it('the original authenticated owner client propagates the exact private narrowing callback through its actual transport',async()=>{
 const binding={protocol:'ordinary_initial_plan_v1' as const,projectId:'p',profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),canonicalCreateOperationId:'create',canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1 as const};
 let checks=0,seen:unknown;const current=()=>{checks++;};const client=createInitialPlanOwnerClient({getDesktopMutationToken:()=> 'private-token',async request(_path,_init,guard){seen=guard;guard?.();return Response.json({ok:true,ownerBinding:binding,planInputRevision:0,reservation:null});}},binding,new AbortController().signal,current);
 const observed=await client.read();expect(observed.state.ok).toBe(true);expect(observed.unclaimedProof).toBeDefined();expect(seen).toBe(current);expect(checks).toBeGreaterThanOrEqual(4);
});
