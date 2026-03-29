import type { Credentials } from '../types.js';
export declare function loadCredentials(): Promise<Credentials | null>;
export declare function saveCredentials(creds: Credentials): Promise<void>;
export declare function clearCredentials(): Promise<void>;
