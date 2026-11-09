import {VERIFICATION_BUDGET} from './protocol.js';

// Framing only: every page retains the original ownership/currentness checks.
// Reserve 64 KiB for the signed identity envelope under the unchanged RPC cap.
export const LEGACY_PUBLICATION_PAGE_BYTES=256*1024;
export const MAX_PUBLICATION_PAGE_BYTES=(VERIFICATION_BUDGET.rpcBytes-64*1024)/4*3;
export const LEGACY_PUBLICATION_PAGE_BASE64=349528;
export const MAX_PUBLICATION_PAGE_BASE64=MAX_PUBLICATION_PAGE_BYTES/3*4;
