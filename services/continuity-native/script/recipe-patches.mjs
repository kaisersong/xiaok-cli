import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Reconstruct committed SOURCE bytes only. This issues no execution, OAuth,
// Native Source, IO, worker lease or full-Harness qualification.
const pins=Object.freeze({"restricted":{"sha256":"6e9407a35382f0a15220522c5fd479d3fe56b79e1163990116bd758c38382974","bytes":50757},"auth-owner":{"sha256":"dcc1840de528c12e003625a438f79515279300b018dfc62618317ec62d8efba0","bytes":308055},"auth-snapshot":{"sha256":"e5ff64d60e7b7683ebfa93480b42ec9e398137bf7a9dfee4eafdb987c4e89560","bytes":31111}});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function sourceBytes(file){
 const before=fs.lstatSync(file,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)throw Error('native_recipe_source_alias');
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});
 for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])if(before[key]!==after[key])throw Error('native_recipe_source_changed');
 return bytes;
}
export function readPinnedRecipePatch(role){
 if(typeof role!=='string'||!Object.hasOwn(pins,role))throw Error('native_recipe_role_rejected');
 const pin=pins[role],root=new URL('../recipe-patches/'+role+'/',import.meta.url);
 const manifest=JSON.parse(sourceBytes(new URL('manifest.json',root)).toString('utf8'));
 if(manifest.schemaVersion!==1||manifest.role!==role||manifest.bytes!==pin.bytes||manifest.sha256!==pin.sha256||!Array.isArray(manifest.parts)||manifest.parts.length<1||manifest.parts.length>256)throw Error('native_recipe_manifest_rejected');
 const chunks=[],seen=new Set();let bytes=0;
 for(const part of manifest.parts){
  if(!part||typeof part.name!=='string'||!/^[0-9]{3}-[a-z0-9_-]+[.][0-9]{2}[.]part$/.test(part.name)||seen.has(part.name)||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>19000||typeof part.sha256!=='string'||!/^[a-f0-9]{64}$/.test(part.sha256))throw Error('native_recipe_part_rejected');
  seen.add(part.name);const chunk=sourceBytes(new URL(part.name,root));
  if(chunk.length!==part.bytes||sha(chunk)!==part.sha256)throw Error('native_recipe_part_changed');
  bytes+=chunk.length;if(bytes>pin.bytes)throw Error('native_recipe_size_changed');chunks.push(chunk);
 }
 const patch=Buffer.concat(chunks);
 if(bytes!==pin.bytes||sha(patch)!==pin.sha256)throw Error('native_recipe_patch_changed');
 return patch;
}
