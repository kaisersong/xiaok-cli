import type { RuntimeEvent } from './events.js';

type RuntimeEventType = RuntimeEvent['type'];
type RuntimeEventHandler<T extends RuntimeEventType> = (
  event: Extract<RuntimeEvent, { type: T }>
) => void;
type AnyRuntimeEventHandler = (event: RuntimeEvent) => void;
export type RuntimeHookUnsubscribe = () => void;

export interface RuntimeHooks {
  on<T extends RuntimeEventType>(type: T, handler: RuntimeEventHandler<T>): RuntimeHookUnsubscribe;
  onAny(handler: AnyRuntimeEventHandler): RuntimeHookUnsubscribe;
  emit(event: RuntimeEvent): void;
}

export function createRuntimeHooks(): RuntimeHooks {
  const handlers = new Map<RuntimeEventType, Set<(event: RuntimeEvent) => void>>();
  const anyHandlers = new Set<AnyRuntimeEventHandler>();

  return {
    on(type, handler) {
      const existing = handlers.get(type) ?? new Set<(event: RuntimeEvent) => void>();
      existing.add(handler as (event: RuntimeEvent) => void);
      handlers.set(type, existing);
      return () => {
        existing.delete(handler as (event: RuntimeEvent) => void);
        if (existing.size === 0) {
          handlers.delete(type);
        }
      };
    },
    onAny(handler) {
      anyHandlers.add(handler);
      return () => {
        anyHandlers.delete(handler);
      };
    },
    emit(event) {
      const typedHandlers = handlers.get(event.type);
      if (typedHandlers) {
        for (const handler of typedHandlers) {
          handler(event);
        }
      }

      for (const handler of anyHandlers) {
        handler(event);
      }
    },
  };
}
