import {types} from 'node:util';
import {loadOriginalMainResourceAuthority} from './original-main-native-loader.js';
import type {OriginalProcessSourceRequest} from './original-process-source-types.js';

const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const apply=Reflect.apply,freeze=Object.freeze,isProxy=types.isProxy;
const NativeError=Error;
export interface OriginalMainSdkPhysicalBridge {
    acquireModel(context:object,attemptId:string,requestDigest:string):Promise<object>;
    consumeModel(permit:object):void;
    assertModelCurrent(permit:object):void;
    assertModelLocal(permit:object):void;
    settleModel(permit:object,receipt:object):Promise<void>;
    cancelModel(permit:object):Promise<void>;
    acquireProcess(context:object,invocationId:string,specHash:string):Promise<object>;
    consumeProcess(permit:object):void;
    settleProcess(permit:object,receipt:object):Promise<void>;
    cancelProcess(permit:object):Promise<void>;
    assertProcessCurrent(permit:object):void;
    assertProcessLocal(permit:object):void;
    readProcessSourceRequest(ticket:unknown):OriginalProcessSourceRequest|null;
    prepareReadonlyLeaf(permit:object,specCanonical:string):Promise<void>;
    waitReadonlyLeafReady(permit:object):Promise<object>;
    bindReadonlyLeaf(permit:object,ready:object):Promise<void>;
    goReadonlyLeaf(permit:object):Promise<void>;
    cancelReadonlyLeaf(permit:object):Promise<void>;
    waitReadonlyLeafClosed(permit:object):Promise<{stdout:string;stderr:string;exitCode:number;signal:number;timedOut:boolean}>;

}
interface Binding {key:unknown;port:unknown;api:object;verify:Function;bridge:OriginalMainSdkPhysicalBridge;retired:boolean}
let binding:Binding|undefined;
function denied():Error{return new NativeError('ROOT_RESOURCE_ORIGINAL_SDK_BRIDGE_REQUIRED');}
function method(object:unknown,name:string):Function {
    if(!object||typeof object!=='object'||isProxy(object))throw denied();
    const row=descriptor(object,name);
    if(!row||!own(row,'value')||typeof row.value!=='function'||isProxy(row.value))throw denied();
    return row.value;
}
function ownershipLocal(row:Binding):void {if(binding!==row)throw denied();}
function local(row:Binding):void {ownershipLocal(row);if(row.retired)throw denied();}
function current(row:Binding):void {
    local(row);
    try {const raw=apply(row.verify,row.api,[row.key,row.port]);if(raw!==undefined)throw raw;}
    catch(error){row.retired=true;throw error;}
    local(row);
}
/** The Native key pins this exact port and original Main session. It is never
 * returned in a public port, DTO, or caller-supplied verifier registration. */
export function installOriginalMainSdkBridge(key:unknown,port:unknown):void {
    const api=loadOriginalMainResourceAuthority();
    const info=apply(method(api,'buildInfo'),api,[]) as unknown;
    if(!info||typeof info!=='object'||isProxy(info)||descriptor(info,'physicalAbi')?.value!=='original_main_physical_v2_nofork_leaf')throw denied();
    const verify=method(api,'assertOriginalModelSdkBridge');
    // This original Native function checks key membership before port attrs.
    const raw=apply(verify,api,[key,port]);if(raw!==undefined)throw raw;
    if(binding){
        if(binding.key!==key||binding.port!==port)throw denied();
        current(binding);return;
    }
    const names=['acquireModel','consumeModel','assertModelCurrent','assertModelLocal',
        'settleModel','cancelModel','acquireProcess','consumeProcess','settleProcess','cancelProcess','assertProcessCurrent','assertProcessLocal','readProcessSourceRequest','prepareReadonlyLeaf','waitReadonlyLeafReady','bindReadonlyLeaf','goReadonlyLeaf','cancelReadonlyLeaf','waitReadonlyLeafClosed'] as const;
    const methods:Function[]=[];
    for(let i=0;i<names.length;i++)methods[i]=method(port,names[i]!);
    const row:Binding={key,port,api:api as object,verify,bridge:undefined!,retired:false};
    function call(index:number,args:unknown[]):unknown {
        // The final Source-local gate must remain entirely local. The fixed
        // original method checks the owner and permit's local state itself.
        // Retirement denies effects, never the attempt to return an already
        // owned resource. Exact captured Owner methods still validate their
        // private permit, original physical fate and one-time negative phase.
        if(index===4||index===5||index===8||index===9||index===12||index===14||index===17||index===18)ownershipLocal(row);
        else if(index===3||index===11)local(row);else current(row);
        return apply(methods[index]!,row.port,args);
    }
    row.bridge=freeze({__proto__:null,
        acquireModel:(context:object,id:string,hash:string)=>call(0,[context,id,hash]) as Promise<object>,
        consumeModel:(permit:object)=>{call(1,[permit]);},
        assertModelCurrent:(permit:object)=>{call(2,[permit]);},
        assertModelLocal:(permit:object)=>{call(3,[permit]);},
        settleModel:(permit:object,receipt:object)=>call(4,[permit,receipt]) as Promise<void>,
        cancelModel:(permit:object)=>call(5,[permit]) as Promise<void>,
        acquireProcess:(context:object,id:string,hash:string)=>call(6,[context,id,hash]) as Promise<object>,
        consumeProcess:(permit:object)=>{call(7,[permit]);},
        settleProcess:(permit:object,receipt:object)=>call(8,[permit,receipt]) as Promise<void>,
        cancelProcess:(permit:object)=>call(9,[permit]) as Promise<void>,
        assertProcessCurrent:(permit:object)=>{call(10,[permit]);},
        assertProcessLocal:(permit:object)=>{call(11,[permit]);},
        readProcessSourceRequest:(ticket:unknown)=>call(12,[ticket]) as OriginalProcessSourceRequest|null,
        prepareReadonlyLeaf:(permit:object,spec:string)=>call(13,[permit,spec]) as Promise<void>,
        waitReadonlyLeafReady:(permit:object)=>call(14,[permit]) as Promise<object>,
        bindReadonlyLeaf:(permit:object,ready:object)=>call(15,[permit,ready]) as Promise<void>,
        goReadonlyLeaf:(permit:object)=>call(16,[permit]) as Promise<void>,
        cancelReadonlyLeaf:(permit:object)=>call(17,[permit]) as Promise<void>,
        waitReadonlyLeafClosed:(permit:object)=>call(18,[permit]) as Promise<{stdout:string;stderr:string;exitCode:number;signal:number;timedOut:boolean}>,
    });
    binding=row;
    current(row);
}
/** Null means no genuine Main installation has occurred. An installed bridge
 * that loses its identity remains closed, including after attempted recovery. */
export function readOptionalOriginalMainSdkBridge():OriginalMainSdkPhysicalBridge|null {
    if(!binding)return null;
    current(binding);return binding.bridge;
}
/** Pure installation fact for choosing the existing ordinary ABI. Retirement
 * stays installed: loss of identity must never revive the ordinary path. */
export function hasOriginalMainSdkBridgeInstallation():boolean{return binding!==undefined;}
/** Passive membership lookup must precede any role SDK or candidate property.
 * Reading historical identity cannot revive retired positive M/P methods. */
export function readOptionalOriginalMainProcessSourceRequest(ticket:unknown):OriginalProcessSourceRequest|null {
    if(!binding)return null;
    return binding.bridge.readProcessSourceRequest(ticket);
}
