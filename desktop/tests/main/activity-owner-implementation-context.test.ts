import {it,expect} from 'vitest';
import {bindOriginalSupervisedBusinessEndpoint} from '../../../src/runtime/conversation-activity/source-supervisor-business.js';
import {bindCanonicalDesktopConfigBirth} from '../../../src/runtime/conversation-activity/source-supervisor-config.js';
import {mintCanonicalDesktopConfigBirth} from '../../../src/runtime/conversation-activity/source-supervisor-config-birth.js';
import {readProcessBirth} from '../../../src/runtime/conversation-activity/source-supervisor-birth.js';
import {createRelay} from '../../electron/activity-owner-writer-relay.js';
import {runMainLaunch} from '../../electron/activity-owner-writer-launch.js';
import {drainDesktopWriterRelay} from '../../electron/activity-owner-writer-drain.js';

it('direct implementation imports reject foreign contexts before reading caller fields',async()=>{
 let reads=0;
 const fake=new Proxy(Object.create(null),{get(){reads++;throw Error('caller getter');}}) as never;
 const none=Object.create(null) as never;
 for(const invoke of [
  ()=>bindOriginalSupervisedBusinessEndpoint(none,none,fake),
  ()=>bindCanonicalDesktopConfigBirth(none,none,'',none,fake),
  ()=>mintCanonicalDesktopConfigBirth(fake),
  ()=>readProcessBirth(process.pid,1000,fake),
 ])expect(invoke).toThrow('activity_original_implementation_context_required');
 expect(()=>createRelay(none,none,none,fake)).toThrow('WRITER_CONFIG_ORIGINAL_IMPLEMENTATION_REQUIRED');
 expect(()=>drainDesktopWriterRelay(none,fake)).toThrow('WRITER_CONFIG_ORIGINAL_IMPLEMENTATION_REQUIRED');
 await expect(runMainLaunch(none,none,fake)).rejects.toThrow('WRITER_CONFIG_ORIGINAL_IMPLEMENTATION_REQUIRED');
 expect(reads).toBe(0);
});
