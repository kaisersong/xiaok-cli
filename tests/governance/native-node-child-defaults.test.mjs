import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
test('production native launch defaults stay inside the fixed bundle and resolve to packaged Node',{skip:process.platform!=='darwin'},()=>{
 const result=spawnSync('clang',['-E','-P','-x','c','-I',root,'-'],{input:'#include "native/broker-authority-source/broker-protocol.h"\nconst char *ks=MI_KSWARM_EXEC;\nconst char *broker=MI_BROKER_EXEC;\n',encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 for(const name of ['ks','broker'])assert.match(result.stdout,new RegExp(`const char \\*${name}=.*Contents/Resources/services/intent-broker/runtime/darwin-${process.arch==='arm64'?'arm64':'x64'}/node`));
});
test('both fixed native launcher environments have no Electron Node mode',()=>{
 for(const name of ['kswarm','broker'])assert.doesNotMatch(readFileSync(new URL(`../../native/${name}-authority-source/${name}-child-launcher.c`,import.meta.url),'utf8'),/ELECTRON_RUN_AS_NODE/);
});
test('readonly leaf production uses the same fixed Native Node macro with no Electron environment',()=>{
 const source=readFileSync(new URL('../../native/root-resource-authority/readonly-leaf.h',import.meta.url),'utf8');
 assert.match(source,/#if \(defined\(NR_FIXTURE_BUILD\).*\!defined\(NR_FIXTURE_LEAF_NODE_EXEC\)/);
 assert.match(source,/#else\n char \*environment\[\]=\{"PATH=\/usr\/bin:\/bin","LANG=C.UTF-8",NULL\};/);
 assert.match(source,/#include "\.\.\/main-installation\/protocol.h"/);
 assert.match(source,/snprintf\(runtime,sizeof\(runtime\),"%s",MI_PACKAGED_NODE_EXEC\)/);
});
