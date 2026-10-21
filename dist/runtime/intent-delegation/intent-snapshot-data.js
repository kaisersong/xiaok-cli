import { captureIntentData } from './data.js';
export function captureIntentSnapshot(snapshot) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, 'intentDelegation');
    if (descriptor && !('value' in descriptor))
        throw Error('intent_commit_accessor');
    return { ...snapshot, intentDelegation: descriptor?.value === undefined ? undefined : captureIntentData(descriptor.value) };
}
