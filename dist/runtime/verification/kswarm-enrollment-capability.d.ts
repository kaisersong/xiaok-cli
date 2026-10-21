import type { Database } from 'better-sqlite3';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
/** Only the actual fixed installed lifetime can issue this private capability. */
export declare function createInstalledKSwarmEnrollmentCapability(lifetime: InstalledControllerLifetime): object | undefined;
export declare function assertKSwarmEnrollmentCapability(token: object | undefined, database: Database): void;
