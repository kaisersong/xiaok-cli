// @vitest-environment node
import {expect,it} from 'vitest';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {EventEmitter} from 'node:events';
import {preserveNativeWorkerGetters} from '../support/native-worker-fixture.js';

it('preserves exact native getters, constructor execution and existing fixture methods',async()=>{
  class Fixture extends Worker { override postMessage(value:unknown){super.postMessage(value);} }
  const send=Fixture.prototype.postMessage;
  expect(preserveNativeWorkerGetters(Worker,Fixture)).toBe(Fixture);
  expect(Fixture.prototype.postMessage).toBe(send);
  for(const name of ['stdout','stderr','stdin','threadId']){
    expect(Object.getOwnPropertyDescriptor(Fixture.prototype,name)).toEqual(Object.getOwnPropertyDescriptor(Worker.prototype,name));
  }
  const worker=new Fixture("process.stdout.write('native-fixture-output')",{eval:true,stdout:true,stderr:true});
  const chunks:string[]=[];worker.stdout!.on('data',value=>chunks.push(String(value)));worker.stderr!.resume();
  try{
    expect(Object.getOwnPropertyDescriptor(Worker.prototype,'stdout')!.get!.call(worker)).toBe(worker.stdout);
    const [exit]=await Promise.all([once(worker,'exit'),once(worker.stdout!,'end')]);
    expect(exit[0]).toBe(0);expect(chunks.join('')).toBe('native-fixture-output');
  }finally{await worker.terminate();}
});
it('retains native receiver rejection for a fake event emitter fixture',()=>{
  class Fake extends EventEmitter {}
  preserveNativeWorkerGetters(Worker,Fake);
  const fake=new Fake();
  for(const name of ['stdout','stderr','stdin']){
    const getter=Object.getOwnPropertyDescriptor(Fake.prototype,name)!.get!;
    expect(getter).toBe(Object.getOwnPropertyDescriptor(Worker.prototype,name)!.get);
    expect(()=>getter.call(fake)).toThrow();
  }
});
it('refuses missing original getter metadata without inventing a replacement',()=>{
  expect(()=>preserveNativeWorkerGetters({prototype:{}} as never,class Fixture{})).toThrow('fixture_native_worker_getter_missing:stdout');
});
it('refuses an incompatible existing fixture getter',()=>{
  class Fake {get stdout(){return null;}}
  expect(()=>preserveNativeWorkerGetters(Worker,Fake)).toThrow('fixture_native_worker_getter_conflict:stdout');
});
