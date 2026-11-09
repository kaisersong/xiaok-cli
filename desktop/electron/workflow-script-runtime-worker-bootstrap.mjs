// Fixed source-checkout entry for tests. Packaged runtimes use the compiled JS.
import {register} from 'tsx/esm/api';
register();
await import('./workflow-script-runtime-worker.ts');
