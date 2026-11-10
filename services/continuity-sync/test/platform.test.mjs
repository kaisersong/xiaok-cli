import test from 'node:test';
import assert from 'node:assert/strict';
import { privateDirectory } from '../src/private-files.mjs';
test('Windows service storage fails before touching a path until its owner/ACL backend is qualified',{skip:process.platform!=='win32'},()=>{
 assert.throws(()=>privateDirectory('unused-private-storage'),/private_storage_platform_unavailable/);
});
