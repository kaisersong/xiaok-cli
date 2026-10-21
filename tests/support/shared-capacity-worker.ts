import {createPrimitiveWorkerAuthority} from './capacity-primitive-worker-bootstrap.mjs';
import Database from 'better-sqlite3';
import {createSharedCapacityLedger} from '../../src/runtime/verification/shared-capacity-ledger.js';
const [path,operationId]=process.argv.slice(2);if(!path||!operationId)throw Error('worker_arguments');
const db=new Database(path),binding={},ledger=createSharedCapacityLedger(createPrimitiveWorkerAuthority({database:db,authorityId:'actual-authority',host:{assertCurrent(){},inspectOwner(value){if(value!==binding)throw Error('worker_binding');return {sessionKey:operationId,producerKey:'producer'};},assertReleased(){throw Error('worker_no_deletion');}}})),owner=ledger.bindOwner(binding);
process.once('message',()=>{let result;try{result={created:ledger.reserve(owner,{operationId,resourceId:operationId,generation:1,partition:'counter',bytes:2*1024**2,bindingHash:'a'.repeat(64)}).created};}catch(error){result={error:String(error)};}finally{ledger.close();db.close();}process.send?.(result,()=>process.disconnect?.());});
process.send?.({ready:true});
