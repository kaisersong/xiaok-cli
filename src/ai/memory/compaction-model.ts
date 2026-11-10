import type {Config,ModelAdapter} from '../../types.js';
import {createAdapterFromBinding} from '../models.js';
import {resolveRuntimeModelBinding} from '../providers/control-plane.js';
import {normalizeMemoryConfiguration,isCompactionModel} from './configuration.js';
import {createLLMFromAdapter} from './layered-store.js';

/** Resolve the existing stateless provider path only after text eligibility. */
export function resolveMemoryCompactionLLM(config: Config,mainAdapter?: ModelAdapter) {
  const memory = normalizeMemoryConfiguration(config);
  if (memory.legacyModelUnresolved) return undefined;
  const selected = memory.compaction?.modelId;
  if (selected !== undefined && selected !== null && typeof selected !== 'string') return undefined;
  const id = selected ?? config.defaultModelId;
  if (!isCompactionModel(config,id)) return undefined;
  const adapter = selected == null && mainAdapter
    ? mainAdapter : createAdapterFromBinding(resolveRuntimeModelBinding(config,id));
  return createLLMFromAdapter(adapter);
}
