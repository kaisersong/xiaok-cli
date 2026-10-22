import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRecorder,verifyTranscript,EVENT_PREFIX,HEALTH_PREFIX} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-core.mjs';

// Rehash edited rows so malformed-schema regressions exercise the real validator,
// rather than merely failing its independent byte-integrity check.
function fixture(){
 const lines=[];let clock=0;
 const recorder=createRecorder({pid:17,nonce:'a'.repeat(32),moduleIdSha256:'b'.repeat(64),now:()=>++clock,writeLine:line=>lines.push(line)});
 for(const site of ['reader','consumer','output'])recorder.siteLoaded(site);
 const error=new Error('loop_publication_read_timeout');
 const token=recorder.readerBegin();recorder.waitBegin(token,'payload');recorder.timerFired(token);recorder.readerFailure(token,error);recorder.readerSettled(token);
 recorder.consumerCatch(error);recorder.outputRejection('task',error);recorder.health();
 return {events:lines.filter(line=>line.startsWith(EVENT_PREFIX)).map(line=>JSON.parse(line.slice(EVENT_PREFIX.length))),health:JSON.parse(lines.find(line=>line.startsWith(HEALTH_PREFIX)).slice(HEALTH_PREFIX.length))};
}
function transcript(value){
 const rows=value.events.map(event=>EVENT_PREFIX+JSON.stringify(event)+'\n');
 Object.assign(value.health,{eventsAttempted:rows.length,eventsEmitted:rows.length,eventSeqLast:rows.length,eventBytes:Buffer.byteLength(rows.join('')),eventsSha256:createHash('sha256').update(rows.join('')).digest('hex')});
 return rows.join('')+HEALTH_PREFIX+JSON.stringify(value.health)+'\n';
}
const bad={
 'event extra private field':v=>{v.events[1].privatePayload='do-not-accept';},
 'health extra field':v=>{v.health.privatePayload='do-not-accept';},
 'site extra field':v=>{v.health.sitesLoaded.extra=1;},
 'missing graph':v=>{delete v.events[1].errors;},
 'kind site mismatch':v=>{v.events[1].site='reader';},
 'event nonnumeric clock':v=>{v.events[1].monotonicMs='private';},
 'health infinite clock':v=>{v.health.monotonicMs=Infinity;},
 'event negative clock':v=>{v.events[1].monotonicMs=-1;},
 'event after health clock':v=>{v.events[1].monotonicMs=v.health.monotonicMs+1;},
 'unknown code':v=>{v.events[1].errors[0].code='private-error';},
 'unclassified cannot claim complete':v=>{v.events[1].errors[0].code='unclassified';},
 'proxy cannot claim complete':v=>{v.events[1].errors[0].kind='proxy';},
 'unknown error kind':v=>{v.events[1].errors[0].kind='anything';},
 'error extra field':v=>{v.events[1].errors[0].message='secret';},
 'error boolean type':v=>{v.events[1].errors[0].incomplete=0;},
 'missing root identity':v=>{v.events[1].errorId=null;},
 'identity zero':v=>{v.events[1].errors[0].id=0;},
 'identity over cap':v=>{v.events[1].errors[0].id=1025;v.events[1].errorId=1025;},
 'root absent from graph':v=>{v.events[1].errorId=2;},
 'dangling cause':v=>{v.events[1].errors[0].causeId=2;},
 'cycle':v=>{v.events[1].errors[0].causeId=1;},
 'duplicate node':v=>{v.events[1].errors.push({...v.events[1].errors[0]});},
 'unreachable node':v=>{v.events[1].errors.push({...v.events[1].errors[0],id:2});},
 'aggregate over four':v=>{v.events[1].errors[0].aggregateErrorIds=[1,1,1,1,1];},
 'aggregate missing identity':v=>{v.events[1].errors[0].aggregateErrorIds=[null];},
 'graph over eight':v=>{v.events[1].errors=Array.from({length:9},(_,i)=>({...v.events[1].errors[0],id:i+1}));},
 'graph depth over four':v=>{v.events[1].errors=Array.from({length:6},(_,i)=>({...v.events[1].errors[0],id:i+1,causeId:i===5?null:i+2}));},
 'unknown reader phase':v=>{v.events[0].phase='private';},
 'unknown phase point kind':v=>{v.events[0].phaseEvents[0].kind='private';},
 'unknown phase point phase':v=>{v.events[0].phaseEvents[0].phase='private';},
 'phase point extra field':v=>{v.events[0].phaseEvents[0].message='private';},
 'phase nonfinite clock':v=>{v.events[0].phaseEvents[0].monotonicMs=NaN;},
 'phase future clock':v=>{v.events[0].phaseEvents[0].monotonicMs=v.events[0].monotonicMs+1;},
 'phase over twenty four':v=>{v.events[0].phaseEvents=Array.from({length:25},()=>({...v.events[0].phaseEvents[0]}));},
 'reader seq out of population':v=>{v.events[0].readerSeq=2;},
 'unknown output action':v=>{v.events[2].action='private';},
 'health count not finite integer':v=>{v.health.readerStarted=1e100;},
 'health extra bytes over bound':v=>{v.health.extra='x'.repeat(4096);},
};
test('real recorder transcript is complete structural health only',()=>{
 const result=verifyTranscript(transcript(fixture()));assert.equal(result.complete,true);assert.equal(result.scope,'health-transcript-only');
});
for(const [name,mutate] of Object.entries(bad))test(name,()=>{const value=fixture();mutate(value);assert.equal(verifyTranscript(transcript(value)).complete,false,name);});
test('all 33 fixed error codes remain admitted, without arbitrary strings',()=>{
 const codes=['loop_publication_read_timeout','loop_publication_owner_unavailable','loop_publication_owner_changed','loop_publication_application_pending','loop_publication_application_changed','loop_publication_not_current','loop_publication_payload','loop_publication_payload_application','loop_publication_changed','application_registration_changed','application_client_owner_changed','publication_installed_owner_changed','controller_ipc_aborted_unknown','loop_projection_closed','loop_projection_admission_sync','loop_projection_changed','loop_projection_task_reader_required','loop_projection_task_changed','loop_projection_publication_changed','loop_completion_subject','loop_completion_unavailable','loop_completion_ticket','loop_completion_changed','loop_output_closed','loop_output_admission_sync','loop_output_changed','loop_output_publication_pending','loop_output_binding','loop_output_directory_changed','loop_output_file_changed','loop_output_publication_changed','loop_output_artifact_not_unique','loop_output_artifact_changed'];
 assert.equal(codes.length,33);
 for(const code of codes){const value=fixture();value.events[1].errors[0].code=code;assert.equal(verifyTranscript(transcript(value)).complete,true,code);}
});
test('valid cause depth four, four aggregate children and eight graph nodes',()=>{
 const value=fixture(),base=value.events[1].errors[0];
 value.events[1].errors=Array.from({length:8},(_,i)=>({...base,id:i+1,causeId:i>0&&i<4?i+2:null,aggregateErrorIds:i===0?[2,6,7,8]:[]}));
 assert.equal(verifyTranscript(transcript(value)).complete,true);
});
test('finally-only cleanup failure is settled as failed without inventing an error event',()=>{
 const lines=[];let clock=0;
 const recorder=createRecorder({pid:17,nonce:'a'.repeat(32),moduleIdSha256:'b'.repeat(64),now:()=>++clock,writeLine:line=>lines.push(line)});
 for(const site of ['reader','consumer','output'])recorder.siteLoaded(site);
 const token=recorder.readerBegin();recorder.returnReady(token);recorder.readerSettled(token,true);recorder.health();
 const result=verifyTranscript(lines.join('\n')+'\n');
 assert.equal(result.receipt.readerFailed,1);assert.equal(result.receipt.readerFulfilled,0);assert.equal(result.receipt.activeReaderCount,0);
 assert.equal(result.complete,true);assert.equal(result.scope,'health-transcript-only');
});
test('observed failure rows cannot exceed the actual failed-reader count',()=>{
 const value=fixture();value.health.readerFailed=0;value.health.readerFulfilled=1;
 assert.equal(verifyTranscript(transcript(value)).complete,false);
});
test('closed required fields cannot be omitted at any schema level',()=>{
 const cases=[v=>{delete v.health.monotonicMs;},v=>{delete v.events[1].monotonicMs;},v=>{delete v.events[1].errors[0].causeId;},v=>{delete v.events[0].phaseEvents[0].kind;}];
 for(const change of cases){const value=fixture();change(value);assert.equal(verifyTranscript(transcript(value)).complete,false);}
});
test('event population 256 and object identity 1024 are inclusive bounds',()=>{
 const value=fixture(),base=value.events[1];
 value.events=Array.from({length:256},(_,i)=>({...base,eventSeq:i+1,monotonicMs:10,errorId:1024,errors:[{...base.errors[0],id:1024}]}));
 value.health.monotonicMs=11;value.health.readerStarted=0;value.health.readerFailed=0;
 assert.equal(verifyTranscript(transcript(value)).complete,true);
 value.events.push({...value.events[0],eventSeq:257});assert.equal(verifyTranscript(transcript(value)).complete,false);
});
test('aggregate emitted UTF-8 bytes cannot exceed 256 KiB',()=>{
 const value=fixture(),base=value.events[1];
 const graph=Array.from({length:8},(_,i)=>({...base.errors[0],id:i+1,code:'loop_publication_application_pending',causeId:i>0&&i<4?i+2:null,aggregateErrorIds:i===0?[2,6,7,8]:[]}));
 value.events=Array.from({length:256},(_,i)=>({...base,eventSeq:i+1,monotonicMs:10,errors:graph}));
 value.health.monotonicMs=11;value.health.readerStarted=0;value.health.readerFailed=0;
 const text=transcript(value);assert.ok(value.health.eventBytes>256*1024);assert.equal(verifyTranscript(text).complete,false);
});
test('phase points 24 are inclusive and timestamps remain finite and ordered',()=>{
 const value=fixture(),event=value.events[0];event.phaseEvents=Array.from({length:24},()=>({...event.phaseEvents[0]}));
 assert.equal(verifyTranscript(transcript(value)).complete,true);
 event.phaseEvents[1].monotonicMs=event.phaseEvents[0].monotonicMs-1;
 assert.equal(verifyTranscript(transcript(value)).complete,false);
});

test('structured line caps are enforced before JSON parsing',()=>{
 const value=fixture();value.events[1].extra='x'.repeat(4096);
 assert.ok(verifyTranscript(transcript(value)).problems.includes('event_capacity'));
 const other=fixture();other.health.extra='x'.repeat(4096);
 assert.ok(verifyTranscript(transcript(other)).problems.includes('health_capacity'));
});
