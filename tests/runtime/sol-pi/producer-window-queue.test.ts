import {it,expect} from 'vitest';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createProducerWindowQueue} from '../../../src/runtime/sol-pi/producer-window-queue.js';
const deferred=()=>{let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};};
it('waits for existing work without running queued producers or holding their callbacks',async()=>{
 const queue=createProducerWindowQueue(),old=deferred(),entered=deferred();let newCalls=0;
 const running=queue.run(async()=>{entered.resolve();await old.promise;});await entered.promise;
 let drained=false;const window=queue.closeAdmission();void window.drained.then(()=>{drained=true;});
 const next=queue.run(async()=>{newCalls++;});await Promise.resolve();expect(drained).toBe(false);expect(newCalls).toBe(0);
 old.resolve();await running;await window.drained;expect(newCalls).toBe(0);window.release();await next;expect(newCalls).toBe(1);
});
it('allows only still-open original scopes to complete nested work while closed',async()=>{
 const queue=createProducerWindowQueue(),entered=deferred(),continueOld=deferred(),nested=deferred();let saved:unknown,nestedDone=false;
 const running=queue.run(async scope=>{saved=scope;entered.resolve();await continueOld.promise;await queue.inherit(scope,async()=>{await nested.promise;nestedDone=true;});});await entered.promise;
 const window=queue.closeAdmission();await expect(queue.inherit({...saved as object} as never,async()=>{})).rejects.toThrow();continueOld.resolve();await Promise.resolve();expect(nestedDone).toBe(false);
 nested.resolve();await running;await window.drained;await expect(queue.inherit(saved as never,async()=>{})).rejects.toThrow();window.release();
});
it('keeps admission closed through a handoff until the real caller releases it',async()=>{
 const queue=createProducerWindowQueue(),window=queue.closeAdmission();await window.drained;let outside=0;
 const waiting=queue.run(async()=>{outside++;});await window.handoff(async()=>{expect(outside).toBe(0);await Promise.resolve();expect(outside).toBe(0);window.release();});await waiting;expect(outside).toBe(1);
 await expect(window.handoff(async()=>{})).rejects.toThrow();
});
it('aborts queued work and wakes all waiters on a failed window without reporting active work drained',async()=>{
 const queue=createProducerWindowQueue(),old=deferred(),entered=deferred(),controller=new AbortController();let calls=0;
 const running=queue.run(async()=>{entered.resolve();await old.promise;});await entered.promise;
 const window=queue.closeAdmission(),cancelled=queue.run(async()=>{calls++;},controller.signal);controller.abort();await expect(cancelled).rejects.toThrow();
 const waiting=queue.run(async()=>{calls++;});const error=Error('publication unconfirmed');window.fail(error);await expect(waiting).rejects.toBe(error);await expect(window.drained).rejects.toBe(error);expect(calls).toBe(0);
 old.resolve();await running;await expect(queue.run(async()=>{})).rejects.toBe(error);
});
it('transfers final publication ownership without making run wait for its own Main tail',async()=>{
 const queue=createProducerWindowQueue();let publication:ReturnType<typeof queue.transfer>|undefined;
 expect(await queue.run(async scope=>{publication=queue.transfer(scope);return 'runner result';})).toBe('runner result');
 const window=queue.closeAdmission();let drained=false;void window.drained.then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 publication!.complete();await window.drained;expect(drained).toBe(true);expect(()=>publication!.complete()).toThrow();window.release();
});
it('reserves capacity for the first-iteration handoff and refuses excess pending callbacks',async()=>{
 const queue=createProducerWindowQueue(),window=queue.closeAdmission();await window.drained;let called=0;
 const waiting=Array.from({length:511},()=>queue.run(async()=>{called++;}));await expect(queue.run(async()=>{called++;})).rejects.toThrow('producer_window_capacity');
 expect(called).toBe(0);await window.handoff(async()=>window.release());await Promise.all(waiting);expect(called).toBe(511);
 const next=queue.closeAdmission();await next.drained;next.release();
});
it('does not release transferred ownership before the producer body has actually returned',async()=>{
 const queue=createProducerWindowQueue(),body=deferred(),entered=deferred();
 const running=queue.run(async scope=>{queue.transfer(scope).complete();entered.resolve();await body.promise;});await entered.promise;
 const window=queue.closeAdmission();let drained=false;void window.drained.then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 body.resolve();await running;await window.drained;window.release();
});
it('keeps the transferred publication continuation inside the old producer until it finishes',async()=>{
 const queue=createProducerWindowQueue(),tail=deferred();let publication!:ReturnType<typeof queue.transfer>;
 await queue.run(async scope=>{publication=queue.transfer(scope);});
 const window=queue.closeAdmission();let drained=false;void window.drained.then(()=>{drained=true;});
 const publishing=publication.run(async()=>{await tail.promise;return 'published';});
 expect(()=>publication.complete()).toThrow('producer_publication_running');expect(drained).toBe(false);
 tail.resolve();expect(await publishing).toBe('published');publication.complete();await window.drained;window.release();
 await expect(publication.run(async()=>{})).rejects.toThrow('producer_publication_already_consumed');
});
it('never invokes a queued producer synchronously between handoff release and the original send',async()=>{
 const queue=createProducerWindowQueue(),window=queue.closeAdmission(),order:string[]=[];await window.drained;
 const waiting=queue.run(async()=>{order.push('next');});
 await window.handoff(async()=>{window.release();order.push('original-send');});await waiting;
 expect(order).toEqual(['original-send','next']);
});
it('cancels an unactivated window without declaring the old producer drained',async()=>{
 const queue=createProducerWindowQueue(),old=deferred(),entered=deferred();let nextCalls=0;
 const running=queue.run(async()=>{entered.resolve();await old.promise;});await entered.promise;
 const window=queue.closeAdmission(),next=queue.run(async()=>{nextCalls++;}),cancelled=Error('confirmed before activation');
 window.cancel(cancelled);expect(nextCalls).toBe(0);await expect(window.drained).rejects.toBe(cancelled);await next;expect(nextCalls).toBe(1);
 const later=queue.closeAdmission();let drained=false;void later.drained.then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 old.resolve();await running;await later.drained;later.release();
});
it('preserves the original producer async owner when a different owner releases the window',async()=>{
 const queue=createProducerWindowQueue(),owner=new AsyncLocalStorage<string>(),window=queue.closeAdmission();await window.drained;
 const pending=owner.run('original',()=>queue.run(async()=>owner.getStore()));
 await owner.run('handoff',()=>window.handoff(async()=>window.release()));
 expect(await pending).toBe('original');
});
