import { AsyncLocalStorage } from 'node:async_hooks';

export interface TurnOrigin {
  source: 'chat' | 'yzj';
  initiator?: string;
  channelTurnId?: string;
}

const origins = new AsyncLocalStorage<TurnOrigin>();

export function runWithTurnOrigin<T>(origin: TurnOrigin, fn: () => T): T {
  return origins.run(origin, fn);
}

export function getTurnOrigin(): TurnOrigin | undefined {
  return origins.getStore();
}
