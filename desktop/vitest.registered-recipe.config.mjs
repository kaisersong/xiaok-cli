import actual from './vitest.config.ts';
import {fileURLToPath} from 'node:url';
const own=p=>fileURLToPath(new URL(p,import.meta.url));
export default {...actual,test:{...actual.test,globalSetup:[...actual.test.globalSetup,own('./tests/fixtures/registered-recipe-account.global.mjs')],setupFiles:[actual.test.setupFiles[0],own('./tests/fixtures/registered-recipe-account.setup.mjs'),...actual.test.setupFiles.slice(1)]}};
