import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../../desktop/electron-builder.json',import.meta.url),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('../../desktop/package.json',import.meta.url),'utf8'));
test('actual locked builder ignore predicate preserves only fixed Node bytes and outer signing policy',async()=>{
 const {MacTargetHelper}=require('app-builder-lib/out/mac/MacTargetHelper.js');
 const helper=new MacTargetHelper({config:{},resourceList:Promise.resolve([]),platformSpecificBuildOptions:config.mac,info:{buildResourcesDir:'/unused-build-resources'}});
 const app='/fixture/xiaok.app';const options=await helper.buildSignOptions(app,null,'distribution',false,config.mac,undefined,1);
 const node=app+'/Contents/Resources/services/intent-broker/runtime/darwin-arm64/node';
 assert.equal(options.ignore(node),true);
 for(const other of [app,app+'/Contents/MacOS/xiaok',app+'/Contents/Resources/services/intent-broker/runtime/protected_sqlite.node',node+'.other',app+'/Contents/Resources/services/else/runtime/darwin-arm64/node'])assert.equal(options.ignore(other),false,other);
 assert.equal(options.optionsForFile(app).hardenedRuntime,true);assert.equal(config.mac.notarize,true);
});
test('Main build copies the fixed closure while preserving the original final absence gate',()=>{
 assert.match(manifest.scripts['build:main'],/ && node scripts\/copy-broker-runtime-package\.cjs && node \.\.\/scripts\/verification\/copy-windows-absence\.mjs desktop$/);
 for(const name of ['pack:dir','pack:release'])assert.ok(manifest.scripts[name].startsWith('npm run prepare:broker-runtime && '));
 const cross=readFileSync(new URL('../../.github/workflows/desktop-cross-platform.yml',import.meta.url),'utf8');
 const release=readFileSync(new URL('../../.github/workflows/desktop-release.yml',import.meta.url),'utf8');
 assert.ok(cross.indexOf('node scripts/prepare-broker-runtime.mjs')<cross.indexOf('name: Package Windows Kimi smoke app'));
 assert.equal((release.match(/node scripts\/prepare-broker-runtime\.mjs/g)||[]).length,2);
});
