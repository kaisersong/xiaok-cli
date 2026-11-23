import {assertRoomTurnCustody,type RoomTurnCustody} from './original-sdk-custody.js';
const apply=Reflect.apply,lastIndexOf=Array.prototype.lastIndexOf,splice=Array.prototype.splice;
/** Drop bookkeeping only after the original custody reports no active root,
 * tail, held resource or unknown. This conveys no execution/Native authority. */
export function releasePhysicallyKnownCustody(owned:RoomTurnCustody[],stock:RoomTurnCustody):void{
 assertRoomTurnCustody(stock);
 try{stock.assertPhysicalKnown();}catch{return;}
 const index=apply(lastIndexOf,owned,[stock]);
 if(index>=0)apply(splice,owned,[index,1]);
}
