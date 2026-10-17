import {it,expect,vi,beforeEach} from 'vitest';
const f=vi.hoisted(()=>({events:[] as string[],failStart:false,failStoreClose:false,lifetime:{base:'/fixed',state:'/fixed/receiver-state',peerHelper:'/fixed/peer',definition:{receiverId:'r',receiverInstanceEpoch:1,keyId:'k'},manifest:{serviceUid:700},privateKey:{},close(){f.events.push('lifetime.close');}}}));
vi.mock('../../../src/runtime/verification/installed-receiver-lifetime.js',()=>({createInstalledReceiverLifetime:()=>f.lifetime,assertInstalledReceiverLifetime:()=>{}}));
vi.mock('../../../src/runtime/verification/installed-receiver-clock.js',()=>({createInstalledReceiverClock:()=>({sample(){},close(){f.events.push('clock.close');}})}));
vi.mock('../../../src/runtime/verification/receiver-store.js',()=>({VerificationReceiverStore:class{constructor(){f.events.push('store.create');}close(){f.events.push('store.close');if(f.failStoreClose)throw Error('unknown');}}}));
vi.mock('../../../src/runtime/verification/receiver-service.js',()=>({startReceiverService:async()=>{f.events.push('server.start');if(f.failStart)throw Error('start-failed');return {async close(){f.events.push('server.close');}};}}));
import {startInstalledVerificationReceiver} from '../../../src/runtime/verification/installed-receiver.js';
beforeEach(()=>{f.events=[];f.failStart=false;f.failStoreClose=false;});
// Actual assembly path with explicit lifecycle fixture ports, not OS qualification.
it('closes service before store/clock and releases lifetime last, using one promise',async()=>{const receiver=await startInstalledVerificationReceiver();const a=receiver.close();expect(receiver.close()).toBe(a);await a;expect(f.events).toEqual(['store.create','server.start','server.close','store.close','clock.close','lifetime.close']);});
it('retains lifetime and dependent components on store cleanup failure',async()=>{const receiver=await startInstalledVerificationReceiver();f.failStoreClose=true;await expect(receiver.close()).rejects.toThrow();expect(f.events).toEqual(['store.create','server.start','server.close','store.close']);});
it('retains lifetime on unresolved partially completed startup',async()=>{f.failStart=true;await expect(startInstalledVerificationReceiver()).rejects.toThrow();expect(f.events).toEqual(['store.create','server.start']);});
it('rejects input overrides before lifetime construction',async()=>{await expect(Reflect.apply(startInstalledVerificationReceiver,null,[{}])).rejects.toThrow('receiver_entry_arguments');expect(f.events).toEqual([]);});
