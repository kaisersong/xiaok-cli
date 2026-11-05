import { z } from 'zod';
import { YZJ_CLI_CONNECTION_SCHEMA } from './yzj-cli-auth-ipc-contract.js';
export { ENTERPRISE_CLI_PROVIDERS, type EnterpriseCliProvider } from '../../src/runtime/enterprise-cli-catalog.js';
export const ENTERPRISE_CLI_PROVIDER_SCHEMA = z.enum(['dingtalk', 'feishu', 'wecom']);
export const ENTERPRISE_CLI_ACTION_SCHEMA = z.enum(['install', 'login', 'setup', 'check', 'cancel']);
export const ENTERPRISE_CLI_CONNECTION_SCHEMA = YZJ_CLI_CONNECTION_SCHEMA.extend({
  identityType: z.enum(['user', 'bot']),
  organization: z.string().min(1).max(300).optional(),
}).strict();
export const ENTERPRISE_CLI_STATE_SCHEMA = z.object({
  provider: ENTERPRISE_CLI_PROVIDER_SCHEMA,
  phase: z.enum(['notInstalled','installing','ready','checking','needsSetup','opening','waiting','connected','signedOut','failed','timedOut','cancelling','stopPending','cancelled','unsupported']),
  revision: z.number().int().nonnegative(),
  installed: z.boolean(),
  version: z.string().max(64).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  connection: ENTERPRISE_CLI_CONNECTION_SCHEMA.optional(),
}).strict();
export const ENTERPRISE_CLI_STATES_SCHEMA = z.array(ENTERPRISE_CLI_STATE_SCHEMA).length(3);
export type EnterpriseCliState = z.infer<typeof ENTERPRISE_CLI_STATE_SCHEMA>;
export type EnterpriseCliAction = z.infer<typeof ENTERPRISE_CLI_ACTION_SCHEMA>;
export type EnterpriseCliConnection = z.infer<typeof ENTERPRISE_CLI_CONNECTION_SCHEMA>;
