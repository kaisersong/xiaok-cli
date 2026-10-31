import { ConversationActivityStore } from '../../../../src/runtime/conversation-activity/store.js';
let store: ConversationActivityStore | undefined;
process.on('message', (command: string) => {
  if (command === 'claim') {
    try { store = new ConversationActivityStore(process.argv[2]); process.send?.({ kind: 'claim', claimed: true }); }
    catch (error) {
      const e = error as Error & { cause?: Error & { errcode?: number } };
      process.send?.({ kind: 'claim', claimed: false, message: e.message, cause: e.cause?.message, errcode: e.cause?.errcode });
    }
  } else if (command === 'write') {
    store!.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op', origin: { profileId: 'p', threadId: 't', workspaceId: 'w', actorId: 'a' } });
    process.send?.({ kind: 'write', value: store!.getAssociation('op') });
  } else if (command === 'release') {
    store?.close(); store = undefined; process.disconnect();
  }
});
process.send?.({ kind: 'ready' });
