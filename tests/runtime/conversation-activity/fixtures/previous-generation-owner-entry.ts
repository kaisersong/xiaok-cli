// Test-only: an owner as built by #23 — generation 2 and a config digest that the current
// client does not recognise (#23 hashed managedSources[*].env, #26 does not).
import { ConversationActivityOwnerHost } from '../../../../src/runtime/conversation-activity/owner-host.js';
import { serveConversationActivityOwner } from '../../../../src/runtime/conversation-activity/owner-runtime.js';
const prototype = ConversationActivityOwnerHost.prototype as unknown as { send(client: unknown, message: any): void };
const original = prototype.send;
prototype.send = function(client, message) {
  if (message?.result?.generation !== undefined) {
    message = { ...message, result: { ...message.result, generation: 2, configDigest: 'digest-from-previous-generation' } };
  }
  original.call(this, client, message);
};
void serveConversationActivityOwner(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
