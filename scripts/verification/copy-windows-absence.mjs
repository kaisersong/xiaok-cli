import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {machine} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDirectory = path.join(sourceRoot, 'src', 'runtime', 'verification', 'native');
const architectures = ['x64', 'arm64'];
const filenames = ['windows-installation-absence.exe', 'windows-installation-absence.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch(error) { if(error.code === 'ENOENT') return false; throw error; }
}
function statPlain(file, directory=false) {
  const stat = fs.lstatSync(file, {bigint:true});
  if(stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n))
    throw Error('Invalid Windows absence artifact file: ' + file);
  return stat;
}
function plainRead(file, limit) {
  const stat = statPlain(file);
  if(stat.size > BigInt(limit)) throw Error('Windows absence artifact too large');
  const bytes = fs.readFileSync(file);
  if(bytes.length > limit) throw Error('Windows absence artifact too large');
  return {file, stat, bytes};
}
function unchanged(record) {
  const current = statPlain(record.file, record.directory);
  for(const key of ['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'])
    if(current[key] !== record.stat[key]) throw Error('Windows absence artifact changed: ' + record.file);
  if(record.bytes && !fs.readFileSync(record.file).equals(record.bytes))
    throw Error('Windows absence artifact changed: ' + record.file);
}
function plainAncestors(root, directory, records) {
  const relative = path.relative(root, directory);
  if(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep))
    throw Error('Windows absence destination outside root');
  let current = root;
  for(const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if(part) current = path.join(current, part);
    if(!exists(current)) break;
    records.set(current, {file:current, stat:statPlain(current,true), directory:true});
  }
}
function sources() {
  const records = new Map(); plainAncestors(sourceRoot,sourceDirectory,records);
  const source = plainRead(path.join(sourceDirectory,'windows-installation-absence.c'),2*1024**2);
  const core = plainRead(path.join(sourceDirectory,'windows-installation-absence-core.h'),64*1024);
  return {source, core, directories:[...records.values()]};
}
function readArtifact(directory, arch, current=sources()) {
  if(!architectures.includes(arch)) throw Error('Invalid Windows absence manifest target');
  if(!exists(path.join(directory,filenames[0])) || !exists(path.join(directory,filenames[1])))
    throw Error('Windows absence artifact missing: ' + directory);
  statPlain(directory,true);
  const payload = plainRead(path.join(directory,filenames[0]),2*1024**2);
  const json = plainRead(path.join(directory,filenames[1]),4096);
  const manifest = JSON.parse(json.bytes.toString('utf8'));
  if(!manifest || Object.keys(manifest).sort().join(',') !== 'coreSha256,sha256,sourceSha256,target,version' ||
     manifest.version !== 1 || manifest.target !== `win32-${arch}` ||
     !['sha256','sourceSha256','coreSha256'].every(key => typeof manifest[key] === 'string' && /^[a-f0-9]{64}$/.test(manifest[key])))
    throw Error('Invalid Windows absence manifest target');
  if(sha(payload.bytes) !== manifest.sha256) throw Error('Windows absence SHA mismatch');
  if(manifest.sourceSha256 !== sha(current.source.bytes) || manifest.coreSha256 !== sha(current.core.bytes))
    throw Error('Windows absence source mismatch');
  const bytes = payload.bytes, offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
  const expected = arch === 'x64' ? 0x8664 : 0xaa64;
  if(bytes.toString('ascii',0,2) !== 'MZ' || offset < 64 || offset + 24 > bytes.length ||
     bytes.toString('ascii',offset,offset+4) !== 'PE\0\0' || bytes.readUInt16LE(offset+4) !== expected)
    throw Error('Windows absence PE target mismatch');
  unchanged(payload); unchanged(json);
  return {manifest,payload,json};
}
export function verifyArtifact(directory, arch) {
  const current = sources(), artifact = readArtifact(directory,arch,current);
  for(const record of [current.source,current.core,...current.directories]) unchanged(record);
  return artifact.manifest;
}
function nativeHost() {
  if(process.platform !== 'win32') return undefined;
  const system = machine().toLowerCase();
  const native = ['amd64','x86_64'].includes(system) ? 'x64' : ['arm64','aarch64'].includes(system) ? 'arm64' : undefined;
  if(!native || native !== process.arch) throw Error('Native Windows architecture required');
  return native;
}
function publish(directory, record) {
  const temporary = path.join(directory, '.' + path.basename(record.file) + '.' + randomBytes(16).toString('hex') + '.tmp');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary,'wx');
    fs.writeFileSync(descriptor,record.bytes);fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);descriptor = undefined;
    // Rename replaces the directory entry; it never writes through a file link.
    fs.renameSync(temporary,path.join(directory,path.basename(record.file)));
  } finally {
    if(descriptor !== undefined) fs.closeSync(descriptor);
    if(exists(temporary)) fs.unlinkSync(temporary);
  }
}
export function copyWindowsAbsence(root, options={}) {
  const {check=false,archs=architectures,desktop=false,requireAll=false,target=desktop?'desktop':'cli'} = options;
  if(![check,desktop,requireAll].every(value => typeof value === 'boolean') ||
     !['cli','desktop','sandbox'].includes(target) || (desktop && target !== 'desktop') ||
     !Array.isArray(archs) || !archs.length || archs.some(arch => !architectures.includes(arch)) ||
     new Set(archs).size !== archs.length ||
     (requireAll && (archs.length !== 2 || !architectures.every(arch => archs.includes(arch)))))
    throw Error('Invalid Windows absence copy arguments');
  const selected = [...archs], host = nativeHost(); // Before any filesystem operation.
  root = path.resolve(root);
  const moduleDirectory = target === 'sandbox' ? path.join(root,'.test-dist','src','runtime','verification')
    : target === 'desktop' ? path.join(root,'desktop','dist','main','src','runtime','verification') : path.join(root,'dist','runtime','verification');
  const reader = path.join(moduleDirectory,'windows-installation-absence.js');
  if(!exists(reader)) {
    if(requireAll || check) throw Error('Windows absence reader missing: ' + moduleDirectory);
    // A missing emitted reader is optional only for a clean native destination.
    // Validate every present input as well; an early no-op cannot bless stale data.
    const records = new Map(), inputs = [];
    let current;
    for(const arch of selected) {
      const destination = path.join(moduleDirectory,'native',`win32-${arch}`);
      plainAncestors(root,destination,records);
      if(exists(destination)) throw Error('Windows absence stale optional destination: ' + destination);
      const source = path.join(sourceRoot,'data','verification','windows',`win32-${arch}`);
      plainAncestors(sourceRoot,source,records);
      if(filenames.some(name => exists(path.join(source,name)))) {
        current ??= sources();
        const pair = readArtifact(source,arch,current);
        inputs.push(pair.payload,pair.json);
      }
    }
    for(const record of [...records.values(),...inputs,...(current ? [current.source,current.core,...current.directories] : [])]) unchanged(record);
    return;
  }
  const directories = new Map(); plainAncestors(root,moduleDirectory,directories);
  const readerRecord = plainRead(reader,2*1024**2), current = sources(), operations = [];
  for(const arch of selected) {
    const destination = path.join(moduleDirectory,'native',`win32-${arch}`);
    plainAncestors(root,destination,directories);
    if(check) { operations.push({arch,destination,existing:readArtifact(destination,arch,current)}); continue; }
    const source = path.join(sourceRoot,'data','verification','windows',`win32-${arch}`);
    plainAncestors(sourceRoot,source,directories);
    const members = filenames.map(name => exists(path.join(source,name)));
    if(members.every(value => !value)) {
      if(requireAll || host === arch) throw Error('Windows absence artifact missing: ' + source);
      if(exists(destination)) throw Error('Windows absence stale optional destination: ' + destination);
      continue;
    }
    const captured = readArtifact(source,arch,current);
    const existing = exists(destination) ? readArtifact(destination,arch,current) : undefined;
    operations.push({arch,destination,captured,existing});
  }
  // Validate every selected architecture and preexisting object before any write.
  for(const record of [readerRecord,current.source,current.core,...current.directories,...directories.values()]) unchanged(record);
  for(const operation of operations) for(const pair of [operation.captured,operation.existing].filter(Boolean)) {
    unchanged(pair.payload);unchanged(pair.json);
  }
  if(check) return;
  for(const operation of operations) {
    fs.mkdirSync(operation.destination,{recursive:true});
    publish(operation.destination,operation.captured.payload);publish(operation.destination,operation.captured.json);
    const copied = readArtifact(operation.destination,operation.arch);
    if(!copied.payload.bytes.equals(operation.captured.payload.bytes) || !copied.json.bytes.equals(operation.captured.json.bytes))
      throw Error('Windows absence copied artifact changed');
  }
  unchanged(current.source);unchanged(current.core);
}
function parse(args) {
  let desktop=false, root=sourceRoot, archs=architectures, check=false, requireAll=false, target;
  const seen = new Set();
  if(['cli','desktop','sandbox'].includes(args[0])) { target=args.shift(); desktop=target === 'desktop'; }
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(!['--root','--arch','--check','--require-all'].includes(flag) || seen.has(flag))
      throw Error('Invalid Windows absence copy arguments');
    seen.add(flag);
    if(flag === '--check') check=true;
    else if(flag === '--require-all') requireAll=true;
    else {
      const value=args[++i];
      if(!value || value.startsWith('--')) throw Error('Invalid Windows absence copy arguments');
      if(flag === '--root') root=path.resolve(value);
      else {if(!architectures.includes(value)) throw Error('Invalid Windows absence copy arguments');archs=[value];}
    }
  }
  return {root,options:{desktop,archs,check,requireAll,...(target ? {target} : {})}};
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const {root,options} = parse(process.argv.slice(2));copyWindowsAbsence(root,options);
}
