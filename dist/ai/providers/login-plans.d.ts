import type { ProviderModelVariant } from './types.js';
export interface ProviderLoginPlan {
    id: 'api' | 'coding';
    label: string;
    baseUrl: string;
    keyPortal: string;
    defaultModel: ProviderModelVariant;
}
/** Plan selection belongs to credential setup; runtime uses the saved endpoint. */
export declare function getProviderLoginPlans(providerId: string): ProviderLoginPlan[];
