import {test} from 'node:test';
import {runOriginalProcessComposition} from './helpers/original-process-composition.mjs';
for (const mode of ['process', 'glob', 'queue', 'grep', 'sourcefault', 'protection', 'delivery', 'preconsume', 'preconsume-undefined', 'preconsume-local'])
  test('actual Main SDK producer retains original P through ' + mode, {skip:process.platform !== 'darwin',timeout:90000},
    () => runOriginalProcessComposition(mode));
