import { registerEmittedGlobContract } from './support/glob-worker-contract.mjs';

registerEmittedGlobContract('Desktop main', new URL('../../desktop/dist/main/src/ai/tools/bounded-glob.js', import.meta.url));
