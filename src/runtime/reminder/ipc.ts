import type {
  XiaokDaemonClientMessage,
  XiaokDaemonRpcErrorMessage,
  XiaokDaemonRpcResultMessage,
  XiaokDaemonServerMessage,
  XiaokDaemonServiceEventMessage,
} from '../daemon/protocol.js';
export {
  createXiaokDaemonRpcId as createReminderRpcId,
  resolveXiaokDaemonSocketPath,
  resolveXiaokDaemonSocketPath as resolveReminderDaemonSocketPath,
  XIAOK_DAEMON_PROTOCOL_VERSION as REMINDER_DAEMON_PROTOCOL_VERSION,
} from '../daemon/protocol.js';

export const REMINDER_DAEMON_SERVICE = 'reminder';

export type ReminderRpcMethod =
  | 'create_from_request'
  | 'create_structured'
  | 'list_for_creator'
  | 'cancel_for_creator'
  | 'status';

export interface ReminderEventPayload {
  sessionId: string;
  reminderId: string;
  content: string;
  message: string;
  createdAt: number;
}

export type ReminderClientMessage = XiaokDaemonClientMessage;
export type ReminderRpcResultMessage = XiaokDaemonRpcResultMessage;
export type ReminderRpcErrorMessage = XiaokDaemonRpcErrorMessage;
export type ReminderServerMessage = XiaokDaemonServerMessage;
export type ReminderEventMessage = XiaokDaemonServiceEventMessage & {
  service: typeof REMINDER_DAEMON_SERVICE;
  name: 'delivery';
  payload: ReminderEventPayload;
};
