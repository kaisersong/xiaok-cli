import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../../.github/workflows/dsh-producer-registration.yml',import.meta.url),'utf8');
const checkouts=[...source.matchAll(/repository: kaisersong\/mydocs\n([\s\S]*?)(?=\n      - (?:uses|name):|$)/g)].map(match=>match[1]);
test('both private checkouts accept only the dedicated key or the existing token and never persist credentials',()=>{
 assert.equal(checkouts.length,2);
 for(const block of checkouts){assert.match(block,/ssh-key: \$\{\{ secrets\.DSH_MYDOCS_READONLY_DEPLOY_KEY \}\}/);assert.match(block,/token: \$\{\{ secrets\.DSH_SIBLING_READ_TOKEN \|\| github\.token \}\}/);assert.match(block,/ssh-strict: true/);assert.match(block,/persist-credentials: false/);assert.doesNotMatch(block,/ref:.*master/);}
});
const guards=[...source.matchAll(/      - name: Require [^\n]*private sibling[^\n]*\n([\s\S]*?)(?=\n      - uses:)/g)].map(match=>match[1]);
test('the guard receives credential presence without exposing either credential to shell',()=>{
 assert.equal(guards.length,2);
 for(const guard of guards){assert.match(guard,/DSH_HAS_READ_CREDENTIAL:.*secrets\.DSH_SIBLING_READ_TOKEN.*secrets\.DSH_MYDOCS_READONLY_DEPLOY_KEY/);assert.doesNotMatch(guard,/\n          (?:DSH_SIBLING_READ_TOKEN|DSH_MYDOCS_READONLY_DEPLOY_KEY):/);}
});
test('the actual target bash guards reject missing credentials and accept presence',{skip:process.platform==='win32'},()=>{
 assert.equal(guards.length,2);
 for(const guard of guards){const marker='        run: |\n',index=guard.indexOf(marker);assert(index>=0);const script=guard.slice(index+marker.length).split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  for(const value of ['','false','true']){const result=spawnSync('bash',['-c',script],{env:{PATH:process.env.PATH,DSH_HAS_READ_CREDENTIAL:value},encoding:'utf8'});assert.equal(result.status,value==='true'?0:1,result.stderr);assert.doesNotMatch(result.stdout,/BEGIN OPENSSH|github_pat_|ghp_/);}
 }
});

test('complete original DSH protocol cases receive the pinned real Broker sibling',()=>{
 const original=source.split('  original-boundary:')[1];
 assert.match(original,/repository: kaisersong\/intent-broker\n\s+ref: 21defd02854fc38ae7526cdff9de3f46bf137311\n\s+path: intent-broker\n\s+persist-credentials: false/);
 assert.match(original,/npm ci --ignore-scripts --prefix \.\.\/intent-broker/);
 assert.match(original,/\['xiaok-cli','kswarm','mydocs','intent-broker'\]/);
});
