import {it,expect,vi} from 'vitest';
import {createControllerRequestTickets} from '../../../src/runtime/verification/controller-request-tickets.js';
it('bounds per session admission without evicting valid tickets and frees only expired slots',()=>{
 let now=1000n;const spy=vi.spyOn(process.hrtime,'bigint').mockImplementation(()=>now);
 try{const tickets=createControllerRequestTickets();const active=Array.from({length:64},()=>tickets.issue('peer-a'));expect(()=>tickets.issue('peer-a')).toThrow('ticket_capacity');expect(()=>tickets.consume(active[0],'peer-b')).toThrow('ticket_unknown');tickets.consume(active[0],'peer-a');expect(()=>tickets.consume(active[0],'peer-a')).toThrow('ticket_unknown');tickets.issue('peer-a');now+=30_000_000_001n;expect(()=>tickets.consume(active[1],'peer-a')).toThrow('ticket_unknown');expect(tickets.issue('peer-a')).toMatch(/^[a-f0-9]{64}$/);}
 finally{spy.mockRestore();}
});
