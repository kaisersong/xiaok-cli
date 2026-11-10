import {types} from 'node:util';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-sdk-custody.js';
import {decodeOriginalRootNmpLedger} from './original-root-nmp-ledger.js';
const write=Writable.prototype.write,end=Writable.prototype.end;
interface Attempt {entered:boolean;close?:()=>Promise<void>;assert?:()=>void;wait?:()=>Promise<void>;owned?:object}
const attempts=new WeakMap<object,Attempt>(),retained=new Set<Attempt>(),LIMIT=64*1024**2;
export function prepareRootNmpCustodyAttempt():object{if(arguments.length)throw Error('ROOT_NMP_CUSTODY_ARGUMENTS');const token=Object.freeze({}),row:Attempt={entered:false};attempts.set(token,row);return token;}
function attempt(token:object):Attempt{const row=attempts.get(token);if(!row)throw Error('ROOT_NMP_CUSTODY_ATTEMPT_REQUIRED');return row;}
export async function closeRootNmpCustodyAttempt(token:object):Promise<void>{const row=attempt(token);if(row.close)await row.close();}
export function readRootNmpCustodyAttemptFate(token:object){const row=attempt(token);return Object.freeze({assertPhysicalKnown(){if(row.entered){if(!row.assert)throw Error('ROOT_NMP_CUSTODY_UNKNOWN');row.assert();}},async waitPhysicalKnown(){if(row.entered){if(!row.wait)throw Error('ROOT_NMP_CUSTODY_UNKNOWN');await row.wait();}}});}
interface Header {state:'held';databaseBytes:string;pid:number;uid:number;directoryPath:string;byteCount:number;sha256:string;ledgerSha256:string;facts:string[][]}
function fields(value:unknown,names:readonly string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...names].sort().join(','))throw Error('ROOT_NMP_CUSTODY_FRAME');}
/** The root broker alone supplies its deployment-bound helper. The child drops
 * to the reviewed UID and Native itself chooses the fixed existing namespace. */
export async function startRootNmpCustodyProcess(token:object,input:{executable:string;uid:number;signal:AbortSignal;maximumBytes:number}){
 const birth=attempt(token);if(birth.entered)throw Error('ROOT_NMP_CUSTODY_ATTEMPT_CONSUMED');
 const {signal,uid}=input;if(!Number.isSafeInteger(uid)||uid<1||!Number.isSafeInteger(input.maximumBytes)||input.maximumBytes<1||input.maximumBytes>128*1024**2)throw Error('ROOT_NMP_CUSTODY_ARGUMENTS');signal.throwIfAborted();
 const stock=createRoomTurnCustody(),negative=createRoomTurnCustody(),raws:unknown[]=[],ioFrames:RoomTurnCustody[]=[],ending=createRoomTurnCustody(),row:{stock:typeof stock;negative:typeof negative;raws:unknown[];ioFrames:RoomTurnCustody[];ending:RoomTurnCustody;child?:object;close?:()=>Promise<void>}={stock,negative,raws,ioFrames,ending};birth.owned=row;retained.add(birth);
 let physicalClosed=false;let attached=false;let child:ChildProcessWithoutNullStreams|undefined,stopping=false,exited=false,exitCode:number|null=null,knownRefusal=false,closedAck=false,first:{raw:unknown}|undefined,unknown=false,closing:Promise<void>|undefined,busy=false,buffer=Buffer.alloc(0),stderrBytes=0;
 let pending:{yes(value:unknown):void;no(raw:unknown):void;timer:NodeJS.Timeout}|undefined,initial:unknown,initialPresent=false;
 let resolveExit!:()=>void;const exit=new Promise<void>(yes=>resolveExit=yes);
 function remember(raw:unknown){first??={raw};raws.push(raw);negative.inventory(raw);}
 function poison(raw:unknown){unknown=true;remember(raw);if(pending){clearTimeout(pending.timer);pending.no(raw);pending=undefined;}}
 async function consumeStdin(this:object){if(this!==child?.stdin)throw Error('ROOT_NMP_CUSTODY_MEMBER');await exit;}
 async function consumeChild(this:object){if(this!==child)throw Error('ROOT_NMP_CUSTODY_MEMBER');await exit;}
 row.close=close;birth.close=close;
 birth.assert=()=>{if(!physicalClosed||unknown)throw Error('ROOT_NMP_CUSTODY_UNKNOWN');for(const s of [stock,negative,ending,...ioFrames])s.assertPhysicalKnown();};
 birth.wait=async()=>{for(const s of [stock,negative,ending,...ioFrames])await s.waitPhysicalKnown();birth.assert!();};
 function attach(value:ChildProcessWithoutNullStreams){
  if(attached){if(child!==value)throw Error('ROOT_NMP_CUSTODY_MEMBER');return;}attached=true;child=value;row.child=value;
  value.on('error',poison);value.stdin.on('error',poison);
  value.stderr.on('data',(bytes:Buffer)=>{stderrBytes+=bytes.length;if(stderrBytes>4096)poison(Error('ROOT_NMP_CUSTODY_STDERR_LIMIT'));});
  value.stdout.on('data',onData);
  value.on('close',(code:number|null)=>{exited=true;exitCode=code;if(pending){const p=pending;pending=undefined;clearTimeout(p.timer);p.no(Error('ROOT_NMP_CUSTODY_EXITED'));}resolveExit();});
 }
 try{
  birth.entered=true;child=await stock.sdk<ChildProcessWithoutNullStreams>(spawn,undefined,[input.executable,[String(uid)],{cwd:'/',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:'pipe'}],{accept(raw){if(!raw||typeof raw!=='object'||types.isProxy(raw))return false;attach(raw as ChildProcessWithoutNullStreams);return true;},consumer:consumeChild});
 }catch(raw){poison(raw);if(child)try{await close();}catch(error){remember(error);}throw raw;}
 function onData(chunk:Buffer){
  if(buffer.length+chunk.length>1024**2){poison(Error('ROOT_NMP_CUSTODY_FRAME_LIMIT'));return;}buffer=Buffer.concat([buffer,chunk]);
  for(;;){const end=buffer.indexOf(10);if(end<0)return;let value:unknown;
   try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,end)));}catch(raw){poison(raw);return;}
   buffer=buffer.subarray(end+1);
   if(pending){const p=pending;pending=undefined;clearTimeout(p.timer);p.yes(value);}
   else if(!initialPresent){initial=value;initialPresent=true;}
   else poison(Error('ROOT_NMP_CUSTODY_UNSOLICITED'));
  }
 }
 async function receive(command?:string,negativeCommand=false):Promise<any>{
  if(!negativeCommand&&(first||closing||stopping))throw first?first.raw:Error('ROOT_NMP_CUSTODY_CLOSING');if(!child)throw first?first.raw:Error('ROOT_NMP_CUSTODY_CONSTRUCTOR_UNKNOWN');if(exited)throw Error('ROOT_NMP_CUSTODY_EXITED');if(pending)throw Error('ROOT_NMP_CUSTODY_CONCURRENT');
  if(!command&&initialPresent){const value=initial;initial=undefined;return value;}
  const answer=new Promise<unknown>((yes,no)=>{const timer=setTimeout(()=>{poison(Error('ROOT_NMP_CUSTODY_TIMEOUT'));},10000);pending={yes,no,timer};});
  if(command){const io=createRoomTurnCustody();ioFrames.push(io);const raw=await io.sdk(write,child!.stdin,[command+'\n']);if(typeof raw!=='boolean')poison(Error('ROOT_NMP_CUSTODY_WRITE_RESULT'));}return answer;
 }
 async function close(){
  if(closing)return closing;
  let yes!:()=>void,no!:(raw:unknown)=>void;closing=new Promise<void>((resolve,reject)=>{yes=resolve;no=reject;});
  const operation=(async()=>{
   if(!child){unknown=true;throw first?first.raw:Error('ROOT_NMP_CUSTODY_CONSTRUCTOR_UNKNOWN');}
   if(!exited&&!knownRefusal)try{const response=await receive('CLOSE',true);fields(response,['state']);if(response.state!=='closed')throw Error('ROOT_NMP_CUSTODY_CLOSE_UNCONFIRMED');closedAck=true;}catch(raw){poison(raw);}
   // A watchdog can bound cleanup, never make missing Native CLOSE known.
   let timer:NodeJS.Timeout|undefined,endedStdin=false;
   try{if(!exited){timer=setTimeout(()=>{unknown=true;try{child!.kill('SIGKILL');}catch(raw){remember(raw);}},1000);endedStdin=true;await ending.sdk(end,child!.stdin,[],{accept(raw){return raw===child!.stdin;},consumer:consumeStdin});}await stock.consumeResource(consumeChild,child!,[]);if(endedStdin)await ending.consumeResource(consumeStdin,child!.stdin,[]);}catch(raw){poison(raw);}finally{if(timer)clearTimeout(timer);}
   if(buffer.length||!closedAck||exitCode!==(knownRefusal?78:0))poison(Error('ROOT_NMP_CUSTODY_CLOSE_UNCONFIRMED'));
   for(const s of [stock,negative,ending,...ioFrames])try{await s.waitPhysicalKnown();s.assertPhysicalKnown();}catch(raw){poison(raw);}
   if(unknown)throw first?first.raw:Error('ROOT_NMP_CUSTODY_UNKNOWN');physicalClosed=true;retained.delete(birth);if(first)throw first.raw;
  })();void operation.then(yes,no);return closing;
 }
 const abort=()=>{stopping=true;negative.inventory(signal.reason);void close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  const raw=await receive();if(raw?.state==='refused'){fields(raw,['state','reasonCode']);if(!['ROOT_LEDGER_ISSUER_BUSY','ROOT_LEDGER_SOURCE_MISSING','ROOT_LEDGER_RECOVERY_REQUIRED','ROOT_LEDGER_LIMIT'].includes(raw.reasonCode))throw Error('ROOT_NMP_CUSTODY_REFUSAL');knownRefusal=true;closedAck=true;const error=Error(raw.reasonCode);remember(error);throw error;}fields(raw,['state','databaseBytes','pid','uid','directoryPath','byteCount','sha256','ledgerSha256','facts']);
  if(typeof raw.databaseBytes!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(raw.databaseBytes)||BigInt(raw.databaseBytes)>BigInt(input.maximumBytes)||raw.state!=='held'||raw.pid!==child.pid||raw.uid!==uid||typeof raw.directoryPath!=='string'||!Number.isSafeInteger(raw.byteCount)||raw.byteCount<1||raw.byteCount>LIMIT||raw.byteCount>input.maximumBytes||!(/^[a-f0-9]{64}$/).test(raw.sha256)||!(/^[a-f0-9]{64}$/).test(raw.ledgerSha256))throw Error('ROOT_NMP_CUSTODY_HEADER');
  const header=raw as Header;
  const owner=Object.freeze({header,pid:child.pid!,async checkCurrent(){if(busy)throw Error('ROOT_NMP_CUSTODY_CONCURRENT');signal.throwIfAborted();const value=await receive('CHECK');fields(value,['state']);if(value.state!=='current')throw Error('ROOT_NMP_CUSTODY_CURRENT');},async read(){
   if(busy)throw Error('ROOT_NMP_CUSTODY_CONCURRENT');busy=true;const bytes=Buffer.alloc(header.byteCount);
   try{for(let offset=0;offset<bytes.length;){signal.throwIfAborted();const length=Math.min(256*1024,bytes.length-offset),value=await receive('PAGE '+offset+' '+length);fields(value,['offset','bytes']);if(value.offset!==offset||typeof value.bytes!=='string')throw Error('ROOT_NMP_CUSTODY_PAGE');const page=Buffer.from(value.bytes,'base64');if(page.length!==length||page.toString('base64')!==value.bytes)throw Error('ROOT_NMP_CUSTODY_PAGE');page.copy(bytes,offset);offset+=length;}
    if(createHash('sha256').update(bytes).digest('hex')!==header.sha256)throw Error('ROOT_NMP_CUSTODY_HASH');const capture=JSON.parse(bytes.toString('utf8'));decodeOriginalRootNmpLedger(capture);return capture;
   }catch(raw){bytes.fill(0);poison(raw);throw raw;}finally{bytes.fill(0);busy=false;}
  },async close(){try{await close();}finally{signal.removeEventListener('abort',abort);}}});return owner;
 }catch(raw){remember(raw);try{await close();}catch(error){remember(error);try{birth.assert!();}catch{throw new AggregateError([raw,error],'ROOT_NMP_CUSTODY_SETUP_UNKNOWN',{cause:raw});}}throw raw;}
}
