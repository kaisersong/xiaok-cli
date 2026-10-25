import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {tmpdir,homedir,userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fileNames=new Set(['manifest.json','manifest.2026-10-06.json','manifest.2026-10-07.json','manifest.2026-10-10-r1.json']);
function privateNode(path,directory=false){const s=lstatSync(path);if(s.isSymbolicLink()||realpathSync(path)!==path||s.uid!==userInfo().uid||(s.mode&0o022)||(directory?!s.isDirectory():!s.isFile()))throw Error('registered_recipe_fixture_node_unsafe');return s;}
export async function snapshotOfficialRecipe(sourceRoot){
 const nativeHome=realpathSync(homedir()),root=join(nativeHome,'.cache','xiaok','sol-pi','deepseek-recipe-0.1.1');privateNode(root,true);
 const {register}=await import(pathToFileURL(join(sourceRoot,'node_modules/tsx/dist/esm/api/index.mjs')).href);const r=register({namespace:'registered-recipe-fixture-'+Date.now()});
 let selected,registered;
 try{const actual=await r.import(join(sourceRoot,'src/runtime/sol-pi/recipe-environment-registration.ts'),import.meta.url);selected=actual.selectRecipeManifestPath(root);registered=actual.isRegisteredRecipeManifest;}finally{await r.unregister();}
 const selectedName=basename(selected);if(!fileNames.has(selectedName))throw Error('registered_recipe_fixture_manifest_selection');
 const entries=[];
 for(const name of [...new Set(['environment.json',selectedName,'manifest.json'])]){const path=join(root,name),stat=privateNode(path);const max=name==='environment.json'?65536:2*1024*1024;if(stat.size>max)throw Error('registered_recipe_fixture_metadata_size');const bytes=readFileSync(path);entries.push({name,sha256:hash(bytes),base64:bytes.toString('base64')});}
 const manifestEntry=entries.find(e=>e.name===selectedName),manifest=JSON.parse(Buffer.from(manifestEntry.base64,'base64').toString('utf8'));
 if(!registered(manifestEntry.sha256,manifest.sha256))throw Error('registered_recipe_fixture_manifest_unregistered');
 const environment=JSON.parse(Buffer.from(entries[0].base64,'base64').toString('utf8'));
 if(Object.keys(environment).sort().join(',')!==['pythonExecutable','sitePackages','tokenizerPath','wheelPath'].sort().join(','))throw Error('registered_recipe_fixture_environment_keys');
 const legacy=JSON.parse(Buffer.from(entries.find(e=>e.name==='manifest.json').base64,'base64').toString('utf8'));if(Object.keys(legacy).sort().join(',')!==Object.keys(manifest).sort().join(','))throw Error('registered_recipe_fixture_legacy_metadata_keys');
 for(const key of ['pythonExecutable','sitePackages','tokenizerPath','wheelPath'])if(environment[key]!==manifest[key])throw Error('registered_recipe_fixture_environment_binding');
 return {version:1,sourceRoot:root,uid:userInfo().uid,selectedName,manifestSemanticSha256:manifest.sha256,entries};
}
export function installOfficialRecipeSnapshot(snapshot,accountRoot){
 const temp=realpathSync(tmpdir()),ownedRoot=realpathSync(accountRoot),home=realpathSync(homedir());privateNode(ownedRoot,true);privateNode(home,true);
 if(dirname(ownedRoot)!==temp||!/^xiaok-vitest-accounts-[A-Za-z0-9]{6}$/.test(basename(ownedRoot))||dirname(home)!==ownedRoot||!/^account-[A-Za-z0-9]{6}$/.test(basename(home))||home===snapshot?.sourceRoot)throw Error('registered_recipe_fixture_account_namespace');
 if(snapshot?.version!==1||snapshot.uid!==userInfo().uid||!fileNames.has(snapshot.selectedName)||!Array.isArray(snapshot.entries))throw Error('registered_recipe_fixture_snapshot_invalid');
 const names=[...new Set(['environment.json',snapshot.selectedName,'manifest.json'])];if(snapshot.entries.length!==names.length)throw Error('registered_recipe_fixture_snapshot_entries');
 const decoded=snapshot.entries.map((e,i)=>{if(e.name!==names[i]||typeof e.base64!=='string'||typeof e.sha256!=='string')throw Error('registered_recipe_fixture_snapshot_entries');const b=Buffer.from(e.base64,'base64');if(b.toString('base64')!==e.base64||hash(b)!==e.sha256||b.length>(e.name==='environment.json'?65536:2*1024*1024))throw Error('registered_recipe_fixture_snapshot_drift');return {name:e.name,bytes:b,sha256:e.sha256};});
 // Refuse existing fixture target; never follow or replace an existing node.
 let parent=home;for(const part of ['.cache','xiaok','sol-pi']){const path=join(parent,part);try{privateNode(path,true);}catch(error){if(error.code!=='ENOENT')throw error;mkdirSync(path,{mode:0o700});privateNode(path,true);}parent=path;}
 const root=join(parent,'deepseek-recipe-0.1.1');mkdirSync(root,{mode:0o700});privateNode(root,true);
 for(const entry of decoded){const path=join(root,entry.name);writeFileSync(path,entry.bytes,{mode:0o400,flag:'wx'});privateNode(path);if(hash(readFileSync(path))!==entry.sha256)throw Error('registered_recipe_fixture_copy_drift');}
 return {root,selected:join(root,snapshot.selectedName),entries:decoded.map(({name,sha256})=>({name,sha256})),qualification:false};
}
