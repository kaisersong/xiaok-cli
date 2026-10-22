import {afterAll} from 'vitest';
import {createRecorder} from './loop-read-error-diagnostic-core.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// A single canonical module import is shared by all three transformed sites.
const moduleIdSha256=createHash('sha256').update(fileURLToPath(import.meta.url).replace(/\\/g,'/')).digest('hex');
export const loopReadDiagnostic=createRecorder({moduleIdSha256});
afterAll(()=>loopReadDiagnostic.health());
