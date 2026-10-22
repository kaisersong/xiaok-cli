import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createOwnedSessionShutdownPlugin} from '../../desktop/tests/fixtures/owned-session-shutdown-loader.mjs';
if(process.env.XIAOK_OWNED_SESSION_SHUTDOWN_CASE!=='1')throw Error('owned_session_case_explicit_launch_required');
const repoRoot=fileURLToPath(new URL('../..',import.meta.url));
export default {root:repoRoot,resolve:{alias:{vitest:resolve(repoRoot,'desktop/node_modules/vitest/dist/index.js')}},plugins:[createOwnedSessionShutdownPlugin({repoRoot,runNonce:process.env.XIAOK_OWNED_SESSION_SHUTDOWN_NONCE})],
 test:{include:['tests/support/desktop-observed-session-owned-shutdown.case.ts'],environment:'node',pool:'forks',maxWorkers:1,
  setupFiles:[],globalSetup:[],testTimeout:120000,hookTimeout:10000,restoreMocks:false,clearMocks:false,isolate:true}};
