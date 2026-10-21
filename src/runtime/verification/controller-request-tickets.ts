import {randomBytes} from 'node:crypto';
/** Process-private monotonic one-use tickets. A new process has no old tickets. */
export function createControllerRequestTickets(){
 const tickets=new Map<string,{principal:string;expires:bigint}>();
 function sweep(){const now=process.hrtime.bigint();for(const [id,value] of tickets)if(value.expires<=now)tickets.delete(id);return now;}
 return Object.freeze({
  issue(principal:string):string{const now=sweep();if(tickets.size>=4096||[...tickets.values()].filter(v=>v.principal===principal).length>=64)throw Error('controller_ticket_capacity');const id=randomBytes(32).toString('hex');tickets.set(id,{principal,expires:now+30_000_000_000n});return id;},
  consume(id:unknown,principal:string):void{sweep();if(typeof id!=='string')throw Error('controller_ticket_unknown');const value=tickets.get(id);if(!value||value.principal!==principal)throw Error('controller_ticket_unknown');tickets.delete(id);},
 });
}
