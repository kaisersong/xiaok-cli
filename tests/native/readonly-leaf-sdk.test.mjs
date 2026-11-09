import {test} from 'node:test';
import {runOriginalProcessComposition} from './helpers/original-process-composition.mjs';
for (const mode of ['sdk-function-tail','sdk-error','sdk-undefined','sdk-raw-tail','sdk-outcome-tail','abort-after-ready','source-revoke','source-revoke-before-ready','source-revoke-after-bind','unknown-raw'])
  test('original Native readonly leaf actual SDK fates: ' + mode,
    {skip:process.platform !== 'darwin',timeout:90000}, () => runOriginalProcessComposition('glob',mode));
