import { AsyncLocalStorage } from 'node:async_hooks';
const origins = new AsyncLocalStorage();
export function runWithTurnOrigin(origin, fn) {
    return origins.run(origin, fn);
}
export function getTurnOrigin() {
    return origins.getStore();
}
