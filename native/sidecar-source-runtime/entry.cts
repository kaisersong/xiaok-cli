import {createRoomTurnCustody} from '../../src/runtime/verification/original-sdk-custody.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';

// Build-bound local SDK/ordinary-discovery helpers only. These exports do not
// contain an issuer, installed context, file-family capability or verifier.
const api={createRoomTurnCustody,retainSourceErrorTails,assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter};
for(const fn of Object.values(api))Object.freeze(fn);
module.exports=Object.freeze(api);
