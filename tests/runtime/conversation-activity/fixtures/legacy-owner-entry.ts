// Test-only wire response patch: run the same owner runtime without generation.
import { ConversationActivityOwnerHost } from '../../../../src/runtime/conversation-activity/owner-host.js';
import { serveConversationActivityOwner } from '../../../../src/runtime/conversation-activity/owner-runtime.js';
const prototype = ConversationActivityOwnerHost.prototype as unknown as { send(client: unknown, message: any): void };
const original = prototype.send;
prototype.send = function(client, message) {
  if (message?.result?.generation !== undefined) {
    const { generation: _generation, ...result } = message.result;
    message = { ...message, result };
  }
  original.call(this, client, message);
};
void serveConversationActivityOwner(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
