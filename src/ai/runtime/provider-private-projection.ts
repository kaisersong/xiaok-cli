import {resolveRegisteredStrictKimiK3Profile} from './model-harness-identity.js';
export {projectProviderPrivateMessages,buildSynthesizedProviderContext,projectStrictToolExecutionContext,assertCapturedMessageSchema} from './provider-private-data.js';
export function isStrictKimiK3Adapter(adapter: object): boolean {
  return resolveRegisteredStrictKimiK3Profile(adapter) !== undefined;
}