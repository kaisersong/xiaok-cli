// UNREVIEWED POST-APPLICATION async-producer combination; NOT RUN.
// Copy to desktop/tests/main/meeting-actions10-async-species.test.ts.
// @vitest-environment node
import { types } from 'node:util';
import { beforeEach, expect, it } from 'vitest';
import { registerMeetingActions10Ipc } from '../../electron/meeting-actions10-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { MEETING_ACTIONS10_METHODS, MEETING_ACTIONS10_INPUT_SCHEMAS, type MeetingActions10Method } from '../../shared/meeting-actions10-ipc-contract.js';
import { encodePcm16Wav } from '../../electron/meeting-audio-format.js';
const NativePromise = Promise;
beforeEach(resetIpcSchemaRegistryForTests);
const meeting = { id:'owned',sourceId:'source',status:'saved',title:'owned',audioFilePath:'/owned.wav',audioRetention:'kept',summaryProvider:'local-only',summaryProviderHash:'',failureReason:'',startedAt:1,endedAt:2,updatedAt:2 };
const source = {id:'source',collectionId:'collection',kind:'meeting',title:'owned',uri:'',mimeType:'audio/wav',sha256:'',byteSize:0,rawPath:'',extractedTextPath:'',parseStatus:'parsed',parseError:'',parseAttempts:0,chunkCount:0,metadata:{},createdAt:1,updatedAt:2};
const summary = {title:'owned',attendees:[],decisions:[],actionItems:[]};
function good(method: MeetingActions10Method): unknown {
  if (method==='pickAudioFile') return '/owned.wav';
  if (method==='saveRecordedAudio') return {ok:true,filePath:'/owned.wav'};
  if (method==='transcribePreview') return {ok:true,text:'owned',segments:[{start:0,end:1,text:'owned'}]};
  if (method==='live:start') return {ok:true,sessionId:'owned'};
  if (method.startsWith('live:')) return {ok:true};
  if (method==='draftRecording') return {ok:true,suggestedTitle:'owned',audioFilePath:'/owned.wav',transcript:'owned',segments:[],summary,summaryMarkdown:'owned'};
  if (method==='processRecording') return {ok:true,meeting,source,chunks:[],summary};
  return {ok:true,meeting,source,chunks:[]};
}
// Genuine method tuples; qualify before pollution so schema rejection cannot
// masquerade as a producer-witness RED. Audio encoder is the production helper.
function validInput(method: MeetingActions10Method): unknown[] {
  const wavBase64 = encodePcm16Wav({ samples: new Int16Array([0]), sampleRate: 16000, channels: 1 }).toString('base64');
  switch (method) {
    case 'pickAudioFile': return [];
    case 'saveRecordedAudio': return [{ title: 'owned', wavBase64 }];
    case 'transcribePreview': return [{ title: 'owned', wavBase64, engine: 'whisper', model: 'base', language: 'zh' }];
    case 'live:start': return [{ engine: 'aliyun-asr', sampleRate: 16000, language: 'zh' }];
    case 'live:pushAudio': return [{ sessionId: 'owned', pcmBase64: Buffer.from([0, 0]).toString('base64') }];
    case 'live:finish': case 'live:cancel': return [{ sessionId: 'owned' }];
    case 'processRecording': return [{ collectionId: 'collection', title: 'owned', audioFilePath: '/owned.wav', engine: 'whisper', model: 'base', language: 'zh', scenario: 'meeting' }];
    case 'draftRecording': return [{ title: 'owned', audioFilePath: '/owned.wav', engine: 'whisper', model: 'base', language: 'zh', scenario: 'meeting' }];
    case 'saveTranscript': return [{ collectionId: 'collection', title: 'owned', audioFilePath: '/owned.wav', transcript: 'owned' }];
  }
}
function fixture(method: MeetingActions10Method, producer: IpcHandlerListener) {
  const listeners=new Map<string,IpcHandlerListener>(),gate=new DesktopShutdownGate();
  const ipc=new ShutdownAwareIpcMain({handle:(channel,handler)=>listeners.set(channel,handler)},gate);
  registerMeetingActions10Ipc(ipc,new Map([['desktop:meeting:'+method,producer]]));
  const args = validInput(method);
  expect(MEETING_ACTIONS10_INPUT_SCHEMAS[method].safeParse(args).success).toBe(true);
  return {gate,invoke:()=>listeners.get('desktop:meeting:'+method)!({}as never,...args)};
}
const turn=()=>new NativePromise<void>(resolve=>setImmediate(resolve));
const rows=MEETING_ACTIONS10_METHODS.flatMap(method=>(['getter','value']as const).flatMap(species=>(['async-success','async-reject']as const).map(outcome=>({method,species,outcome}))));
it.each(rows)('actual registrar $method pre-producer species $species/$outcome has zero effects/getter reads/orphan rejects',async({method,species,outcome})=>{
  let effects=0,reads=0,producerCalls=0;
  // True async function creates its Promise on invocation; no prebuilt resolved raw.
  async function producer() { producerCalls++; effects++; await undefined; if(outcome==='async-reject')throw Error('owned-inner-rejection-marker');return good(method); }
  const f=fixture(method,producer),descriptor=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)!;
  const orphans:unknown[]=[],observe=(reason:unknown)=>{orphans.push(reason);};process.on('unhandledRejection',observe);
  let pending:unknown;
  try {
    try {Object.defineProperty(NativePromise,Symbol.species,species==='getter'?{configurable:true,get(){reads++;return NativePromise;}}:{configurable:true,value:NativePromise});pending=f.invoke();}
    finally {Object.defineProperty(NativePromise,Symbol.species,descriptor);}
    expect(types.isPromise(pending)).toBe(true);
    const result=await(pending as Promise<unknown>).then(()=>null,error=>error);
    await turn();await turn();
    expect(result).toBeInstanceOf(Error);expect(result.message).toBe('meeting_actions10_projection_unavailable');
    expect(effects).toBe(0);expect(producerCalls).toBe(0);expect(reads).toBe(0);expect(orphans).toEqual([]);expect(f.gate.outstanding).toBe(0);
  } finally {Object.defineProperty(NativePromise,Symbol.species,descriptor);process.removeListener('unhandledRejection',observe);}
});
it.each(MEETING_ACTIONS10_METHODS)('actual registrar %s normal async success settles once with physical token held',async method=>{
  let release!:()=>void;const hold=new NativePromise<void>(resolve=>{release=resolve;});
  let producerCalls=0;
  async function producer() { producerCalls++; await hold; return good(method); }
  const f=fixture(method,producer),pending=f.invoke();
  expect(producerCalls).toBe(1);expect(f.gate.outstanding).toBe(1);release();expect(await pending).toEqual(good(method));expect(producerCalls).toBe(1);expect(f.gate.outstanding).toBe(0);
});
it.each(MEETING_ACTIONS10_METHODS)('actual registrar %s normal async rejection is observed with original fixed Error identity',async method=>{
  const error=Error('meeting_live_failed'),orphans:unknown[]=[],observe=(reason:unknown)=>{orphans.push(reason);};process.on('unhandledRejection',observe);
  let producerCalls=0;async function producer() { producerCalls++; await undefined; throw error; }
  try {const f=fixture(method,producer);await expect(f.invoke()).rejects.toBe(error);await turn();await turn();expect(producerCalls).toBe(1);expect(orphans).toEqual([]);expect(f.gate.outstanding).toBe(0);}
  finally {process.removeListener('unhandledRejection',observe);}
});
