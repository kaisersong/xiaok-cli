// Fixed packaged Node preloader. Resource location is derived from this file,
// never inherited from an environment variable. It supplies paths, no grants.
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const resources=resolve(dirname(fileURLToPath(import.meta.url)),'..');
Object.defineProperty(process,'resourcesPath',{value:resources,writable:false,configurable:false});
