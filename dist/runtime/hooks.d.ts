import type { RuntimeEvent } from './events.js';
type RuntimeEventType = RuntimeEvent['type'];
type RuntimeEventHandler<T extends RuntimeEventType> = (event: Extract<RuntimeEvent, {
    type: T;
}>) => void;
type AnyRuntimeEventHandler = (event: RuntimeEvent) => void;
export type RuntimeHookUnsubscribe = () => void;
export interface RuntimeHooks {
    on<T extends RuntimeEventType>(type: T, handler: RuntimeEventHandler<T>): RuntimeHookUnsubscribe;
    onAny(handler: AnyRuntimeEventHandler): RuntimeHookUnsubscribe;
    emit(event: RuntimeEvent): void;
}
export declare function createRuntimeHooks(): RuntimeHooks;
export {};
