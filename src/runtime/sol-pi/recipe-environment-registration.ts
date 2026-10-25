// Fixed host registrations bind the complete manifest bytes to its semantic
// identity. Matching data does not issue a counter, permission or authority.
const originalBytes='50117314e0001bac768e500792d951f9b80fef8b97204a7dc6cd857a9a2713dd';
const originalSemantic='a0e31c572efb0fbf2723ac56a6c65caf22efd931ac60458a7d38c1e255b21417';
const currentBytes='969176f17fbe17fae8ae51b73746019f78e5739fb97005d39f99a8aa1c7e90a3';
const currentSemantic='bda655eb6c90b5e0fa9abddbe250a1fb1153e918dcd613801032e2114aaf4908';
const freshBytes='7f0a028c0ca6331b3cf8550fe341e1b3d2a896ebb890d68633624c7b83c8d71f';
const freshSemantic='ab755e9b459899999917365262f713f5907fe335acebc14b6669768fa3d10c40';
const qualified20261010Bytes='8fff26fce52fc249b30c4d18c758f0c93aca9ec03d36d2a029cb56d231e3cb35';
const qualified20261010Semantic='03e80e3e4a52a5125131dce25c21096202e73088745c06e33e84baa4619b98f8';
export function isRegisteredRecipeManifest(bytes:unknown,semantic:unknown):boolean {
  return bytes===originalBytes&&semantic===originalSemantic
    ||bytes===currentBytes&&semantic===currentSemantic
    ||bytes===freshBytes&&semantic===freshSemantic
    ||bytes===qualified20261010Bytes&&semantic===qualified20261010Semantic;
}

/** Selects data only. Existing invalid entries must be rejected by qualification. */
export function selectRecipeManifestPath(root:string):string {
  const qualified=join(root,'manifest.2026-10-10-r1.json');
  try { lstatSync(qualified); return qualified; }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
  }
  const fresh=join(root,'manifest.2026-10-07.json');
  try { lstatSync(fresh); return fresh; }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
  }
  const current=join(root,'manifest.2026-10-06.json');
  try { lstatSync(current); return current; }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return join(root,'manifest.json');
    throw error;
  }
}
import {lstatSync} from 'node:fs';
import {join} from 'node:path';
