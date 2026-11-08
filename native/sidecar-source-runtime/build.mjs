import {build} from 'esbuild';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {Script} from 'node:vm';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// This is a build tool output, never a runtime path or authorization argument.
if(process.argv.length!==3)throw Error('one explicit private build output required');
const output=resolve(process.argv[2]);await mkdir(dirname(output),{recursive:true});
const options={absWorkingDir:root,entryPoints:[join(root,'native/sidecar-source-runtime/entry.cts')],outfile:output,bundle:true,platform:'node',format:'cjs',target:'node22.14',packages:'external',metafile:true,write:false,define:{'import.meta.url':'__xiaokSidecarSourceModuleUrl'},banner:{js:"const __xiaokSidecarSourceModuleUrl=require('node:url').pathToFileURL(__filename).href;"}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const graph=await build(options),before={};
for(const path of Object.keys(graph.metafile.inputs)){const absolute=resolve(root,path),bytes=await readFile(absolute),facts=await stat(absolute,{bigint:true});before[absolute]={sha256:hash(bytes),bytes:bytes.length,mtimeNs:String(facts.mtimeNs)};}
const result=await build(options);
if(JSON.stringify(Object.keys(graph.metafile.inputs).sort())!==JSON.stringify(Object.keys(result.metafile.inputs).sort()))throw Error('sidecar source graph changed during build');
for(const [path,expected]of Object.entries(before)){const actual=await readFile(path),facts=await stat(path,{bigint:true});if(hash(actual)!==expected.sha256||String(facts.mtimeNs)!==expected.mtimeNs)throw Error('sidecar source bytes changed during build');}
if(result.outputFiles.length!==1||result.outputFiles[0].contents.length<1000)throw Error('sidecar source runtime build empty');
const data=result.outputFiles[0].contents;new Script(Buffer.from(data).toString('utf8'),{filename:output});await writeFile(output,data);
const inputs={};
for(const path of Object.keys(result.metafile.inputs)){const absolute=resolve(root,path),bytes=await readFile(absolute);inputs[absolute]={sha256:hash(bytes),bytes:bytes.length,mtimeNs:before[absolute].mtimeNs};}
await writeFile(output+'.manifest.json',JSON.stringify({output,sha256:hash(data),bytes:data.length,inputs,qualification:false},null,2)+'\n');
console.log(JSON.stringify({output,sha256:hash(data),bytes:data.length,inputCount:Object.keys(inputs).length,qualification:false}));
