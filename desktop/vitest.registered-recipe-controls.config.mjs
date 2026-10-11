import configured from './vitest.registered-recipe.config.mjs';
import {fileURLToPath} from 'node:url';
export default {...configured,test:{...configured.test,include:[fileURLToPath(new URL('./tests/main/registered-recipe-account-controls.test.mjs',import.meta.url))]}};
