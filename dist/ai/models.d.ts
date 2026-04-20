import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { type ResolvedModelBinding } from './providers/control-plane.js';
export declare function createAdapterFromBinding(binding: ResolvedModelBinding): ModelAdapter;
export declare function createAdapter(rawConfig: Config | LegacyConfig): ModelAdapter;
