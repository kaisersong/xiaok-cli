import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../../.github/workflows/'+name,import.meta.url),'utf8');
const workflow=read('desktop-cross-platform.yml');
const release=read('desktop-release.yml');
function job(id,source=workflow){
 const lines=source.split(/\r?\n/),start=lines.findIndex(line=>line==='  '+id+':');assert.notEqual(start,-1,'missing job '+id);
 let end=start+1;while(end<lines.length&&!/^  [a-zA-Z0-9_-]+:/.test(lines[end]))end++;
 return lines.slice(start,end).join('\n');
}
function assertPreparedBeforePackaging(body,installStep,buildStep,packStep){
 const install=body.indexOf(installStep),prepare=body.indexOf('node scripts/prepare-packaged-yzj-cli.cjs');
 const verify=body.indexOf('node --test tests/scripts/prepare-packaged-yzj-cli.test.mjs');
 const build=body.indexOf('name: '+buildStep),pack=body.indexOf('name: '+packStep);
 assert.ok(install>=0,'missing dependency install step');
 assert.ok(prepare>install,'prepare-packaged-yzj-cli must run after dependency install');
 assert.ok(verify>prepare,'prepared bundled CLI lifecycle test must follow prepare');
 assert.ok(build>verify&&pack>build,'installer prerequisite must run before build/pack');
 const step=body.slice(body.lastIndexOf('      - name:',prepare),prepare);
 assert.match(step,/working-directory: desktop/);
}
test('path tests keep the exact declared CLI minimum Node',()=>{
 assert.match(job('cross-platform-tests'),/node-version: ['"]22\.14\.0['"]/);
});
test('packaging uses a fixed supported build toolchain without lowering the KSwarm floor',()=>{
 assert.match(job('windows-kimi-packaged-smoke'),/node-version: ['"]24\.16\.0['"]/);
});
test('packaged smoke prepares the exact bundled CLI before its original build/package gates',()=>{
 assertPreparedBeforePackaging(job('windows-kimi-packaged-smoke'),'npm ci --ignore-scripts','Build desktop','Package Windows Kimi smoke app');
});
// 1.6.3 RC blocker: desktop-release.yml shipped without the prepare step, so
// after-pack's packaged yzj-cli verification would fail on the tagged build.
test('release macOS build prepares the exact bundled CLI before build/package',()=>{
 assertPreparedBeforePackaging(job('build-mac',release),'npm ci','Build desktop','Package signed macOS app');
});
test('release Windows build prepares the exact bundled CLI before build/package',()=>{
 assertPreparedBeforePackaging(job('build-windows',release),'npm ci','Build desktop','Package Windows installer');
});
