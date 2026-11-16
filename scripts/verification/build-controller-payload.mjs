import {build} from 'esbuild';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'../..');
const destination=process.argv[2];
if(process.argv.length!==3||!destination)throw Error('explicit_new_payload_directory_required');
const output=resolve(destination);if(existsSync(output))throw Error('payload_directory_exists');
mkdirSync(join(output,'app'),{recursive:true,mode:0o700});mkdirSync(join(output,'bin'),{mode:0o700});
// Copy the exact executing Node, which supplies built-in SQLite. The final package
// inventory freezes all bytes; this builder neither signs nor installs anything.
copyFileSync(process.execPath,join(output,'bin/node'));
const verificationEntries={'root-nmp-custody':'root-nmp-custody-entry.ts','source-lock-cleanup':'source-lock-cleanup-entry.ts',controller:'controller-entry.ts',receiver:'receiver-entry.ts',deployment:'deployment-command-entry.ts','root-broker':'root-broker-entry.ts','controller-transport':'controller-transport-entry.ts','receiver-clock-transport':'receiver-clock-transport-entry.ts'};
const entries={...Object.fromEntries(Object.entries(verificationEntries).map(([name,source])=>[name,join('src/runtime/verification',source)])),egress:'src/runtime/sol-pi/egress-entry.ts',participant:'src/runtime/sol-pi/participant-entry.ts'};
for(const [name,source] of Object.entries(entries))await build({entryPoints:[join(root,source)],bundle:true,platform:'node',target:'node24',format:'cjs',outfile:join(output,'app',name+'.cjs'),define:{'import.meta.url':'__xiaokModuleUrl'},banner:{js:"const __xiaokModuleUrl = require('node:url').pathToFileURL(__filename).href;"},logLevel:'silent'});
function copyTree(source,target){const stat=lstatSync(source);if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw Error('payload_dependency_link');if(stat.isDirectory()){mkdirSync(target,{recursive:true});for(const name of require('node:fs').readdirSync(source)){if(name.startsWith('.'))continue;copyTree(join(source,name),join(target,name));}}else copyFileSync(source,target);}
// Fixed sibling Room runtime; package inventory freezes every copied byte.
// Its production imports are local room modules or Node builtins, never user paths.
const participantSource=resolve(root,'../intent-broker'),participantTarget=join(output,'participant-runtime');
copyTree(join(participantSource,'src/room'),join(participantTarget,'room'));
const participantPackage=JSON.parse(readFileSync(join(participantSource,'package.json'),'utf8'));
writeFileSync(join(participantTarget,'package.json'),JSON.stringify({type:'module',name:'xiaok-fixed-participant-runtime',sourceVersion:participantPackage.version})+'\n');
copyFileSync(join(participantSource,'LICENSE'),join(participantTarget,'LICENSE'));
writeFileSync(join(output,'payload-components.json'),JSON.stringify({schemaVersion:1,nodeVersion:process.version,nodeHash:createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),entries:Object.keys(entries),controllerComposition:'assembled-private-stack',installable:false},null,2)+'\n');
process.stdout.write(JSON.stringify({output,entries:Object.keys(entries),installable:false})+'\n');
