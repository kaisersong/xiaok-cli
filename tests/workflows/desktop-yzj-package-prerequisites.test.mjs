import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../../.github/workflows/desktop-cross-platform.yml',import.meta.url),'utf8');
function job(id){
 const lines=workflow.split(/\r?\n/),start=lines.findIndex(line=>line==='  '+id+':');assert.notEqual(start,-1);
 let end=start+1;while(end<lines.length&&!/^  [a-zA-Z0-9_-]+:/.test(lines[end]))end++;
 return lines.slice(start,end).join('\n');
}
test('path tests keep the exact declared CLI minimum Node',()=>{
 assert.match(job('cross-platform-tests'),/node-version: ['"]22\.14\.0['"]/);
});
test('packaging uses a fixed supported build toolchain without lowering the KSwarm floor',()=>{
 assert.match(job('windows-kimi-packaged-smoke'),/node-version: ['"]24\.16\.0['"]/);
});
test('packaged smoke prepares the exact bundled CLI before its original build/package gates',()=>{
 const body=job('windows-kimi-packaged-smoke');
 const install=body.indexOf('npm ci --ignore-scripts'),prepare=body.indexOf('node scripts/prepare-packaged-yzj-cli.cjs');
 const build=body.indexOf('name: Build desktop'),pack=body.indexOf('name: Package Windows Kimi smoke app');
 assert.ok(install>=0&&prepare>install&&build>prepare&&pack>build,'installer prerequisite must run before build/pack');
 const step=body.slice(body.lastIndexOf('      - name:',prepare),prepare);
 assert.match(step,/working-directory: desktop/);
});
