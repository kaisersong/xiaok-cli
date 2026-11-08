/** Fixed post-drop ordinary child. No caller path, SQL, provider or issuer. */
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {loadOriginalRootLedgerSource} from './original-root-ledger-source-loader.js';
import {decodeOriginalRootNmpLedger} from './original-root-nmp-ledger.js';
import {createRoomTurnCustody,type RoomTurnCustody} from './original-sdk-custody.js';
import {types} from 'node:util';
const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const frames:RoomTurnCustody[]=[],rawGraph:unknown[]=[],stock=createRoomTurnCustody(),negative=createRoomTurnCustody();
let first:{raw:unknown}|undefined,holder:object|undefined,read:Function|undefined,check:Function|undefined,close:Function|undefined,assertClosed:Function|undefined,entered=false,closing=false,bytes:Buffer|undefined;
function remember(raw:unknown){first??={raw};rawGraph.push(raw);negative.inventory(raw);}
function method(value:unknown,key:string):Function{if(!value||typeof value!=='object'||types.isProxy(value))throw Error('ROOT_NMP_CUSTODY_SHAPE');const d=descriptor(value,key);if(!d||!own(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))throw Error('ROOT_NMP_CUSTODY_SHAPE');return d.value;}
async function closeHeld(this:object){if(this!==holder||!close)throw Error('ROOT_NMP_CUSTODY_MEMBER');const frame=createRoomTurnCustody();frames.push(frame);const raw=await frame.sdk(close,this,[]);if(raw!==undefined)throw Error('ROOT_NMP_CUSTODY_CLOSE_RESULT');}
async function send(value:unknown){const frame=JSON.stringify(value)+'\n';await new Promise<void>((yes,no)=>{try{process.stdout.write(frame,error=>error?no(error):yes());}catch(raw){no(raw);}});}
async function run(){
 if(process.argv.length!==2||!process.getuid||process.getuid()===0||process.getuid()!==process.geteuid?.())throw Error('ROOT_NMP_CUSTODY_UID');
 const api=loadOriginalRootLedgerSource(),open=method(api,'holdExistingOriginalRootPoolLedger'),closeAll=method(api,'closeOriginalRootPoolLedgerSource');
 const cleanup=async()=>{
  if(closing)return;closing=true;let cleanupFailure:{raw:unknown}|undefined;
  if(holder&&close)try{await stock.consumeResource(closeHeld,holder,[]);}catch(raw){cleanupFailure={raw};remember(raw);}
  if(entered)try{const frame=createRoomTurnCustody();frames.push(frame);const raw=await frame.sdk(closeAll,api,[]);if(raw!==undefined)throw Error('ROOT_NMP_CUSTODY_CLOSE_RESULT');}catch(raw){cleanupFailure??={raw};remember(raw);}
  if(holder&&assertClosed)try{const frame=createRoomTurnCustody();frames.push(frame);const raw=await frame.sdk(assertClosed,holder,[]);if(raw!==undefined)throw Error('ROOT_NMP_CUSTODY_TERMINAL_RESULT');}catch(raw){cleanupFailure??={raw};remember(raw);}
  let physical:{raw:unknown}|undefined;
  for(const held of [stock,negative,...frames])try{await held.waitPhysicalKnown();held.assertPhysicalKnown();}catch(raw){physical??={raw};remember(raw);}
  if(physical)throw physical.raw;if(cleanupFailure)throw cleanupFailure.raw;
  bytes?.fill(0);bytes=undefined;
 };
 const input=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
 try{
  entered=true;
  holder=await stock.sdk<object>(open,api,[],{accept(raw){if(!raw||typeof raw!=='object'||types.isProxy(raw))return false;holder=raw;read=method(raw,'read');check=method(raw,'check');close=method(raw,'close');assertClosed=method(raw,'assertClosed');return true;},consumer:closeHeld,strictProxyGraph:true});
  const raw=await stock.sdk(read!,holder,[]),ledger=decodeOriginalRootNmpLedger(raw);
  bytes=Buffer.from(JSON.stringify(raw));if(bytes.length>64*1024**2)throw Error('ROOT_NMP_CUSTODY_LIMIT');
  const path=descriptor(holder,'directoryPath');if(!path||!own(path,'value')||typeof path.value!=='string')throw Error('ROOT_NMP_CUSTODY_PATH');
  const databaseBytes=descriptor(holder,'databaseBytes');if(!databaseBytes||!own(databaseBytes,'value')||typeof databaseBytes.value!=='string')throw Error('ROOT_NMP_CUSTODY_PATH');
  await send({state:'held',databaseBytes:databaseBytes.value,pid:process.pid,uid:process.getuid(),directoryPath:path.value,byteCount:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),ledgerSha256:(raw as {sha256:string}).sha256,facts:ledger.sourceIdentity.facts});
  for await(const line of input){
   if(line.length>128)throw Error('ROOT_NMP_CUSTODY_PROTOCOL');
   if(line==='CLOSE'){await cleanup();await send({state:'closed'});return;}
   if(line==='CHECK'){const raw=await stock.sdk(check!,holder,[]);if(raw!==undefined)throw Error('ROOT_NMP_CUSTODY_CHECK_RESULT');await send({state:'current'});continue;}
   const parts=/^PAGE (0|[1-9][0-9]*) ([1-9][0-9]*)$/.exec(line);if(!parts)throw Error('ROOT_NMP_CUSTODY_PROTOCOL');
   const offset=Number(parts[1]),length=Number(parts[2]);if(!bytes||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||length>256*1024||offset>bytes.length||length>bytes.length-offset)throw Error('ROOT_NMP_CUSTODY_RANGE');
   await stock.sdk(check!,holder,[]);const data=bytes.subarray(offset,offset+length).toString('base64');await stock.sdk(check!,holder,[]);await send({offset,bytes:data});
  }
  throw Error('ROOT_NMP_CUSTODY_CHANNEL_ENDED');
 }catch(raw){remember(raw);let known=false;try{await cleanup();known=true;}catch(error){remember(error);}bytes?.fill(0);
  const data=raw&&!types.isProxy(raw)&&types.isNativeError(raw)?descriptor(raw,'message'):undefined;
  const code=data&&own(data,'value')&&typeof data.value==='string'?data.value:'';
  if(!holder&&known&&['ROOT_LEDGER_ISSUER_BUSY','ROOT_LEDGER_SOURCE_MISSING','ROOT_LEDGER_RECOVERY_REQUIRED','ROOT_LEDGER_LIMIT'].includes(code)){await send({state:'refused',reasonCode:code});process.exitCode=78;}
  else{await send({state:'unknown'});process.exitCode=79;}

 }finally{input.close();process.stdin.pause();}
}
void run().catch(async raw=>{remember(raw);try{await send({state:'unknown'});}catch(error){remember(error);}process.exitCode=79;});
