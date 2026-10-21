import {it,expect} from 'vitest';
import {parseIntentReceiverCommand} from '../../src/commands/chat-intent-receiver.js';
it('requires explicit user receiver actions and original candidate identity',()=>{
 for(const kind of ['publish','recover','retry','project'])expect(parseIntentReceiverCommand(`/intent receiver ${kind} candidate-id`)).toEqual({kind,candidateId:'candidate-id'});
 for(const kind of ['status','help','cancel'])expect(parseIntentReceiverCommand(`/intent receiver ${kind}`)).toEqual({kind});
 for(const text of ['/intent receiver publish','/intent receiver project a b','/intent receiver retry a\u0000b','/intent receiver unknown candidate','/intent receiver status extra'])expect(()=>parseIntentReceiverCommand(text)).toThrow();
 expect(parseIntentReceiverCommand('/intent verify status')).toBeNull();
});
