import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  fstatSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import {assertSourceSyncCustodyContext,invokeSourceSyncSdk} from '../runtime/task-host/source-sync-custody.js';
import {types} from 'node:util';
const nativePlatform=process.platform,nativePid=process.pid,nativeUuid=randomUUID,nativeFstat=fstatSync;
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,define=Object.defineProperty;
const NativeAggregateError=AggregateError;
const sourceIsProxy=types.isProxy;

export interface AtomicFileOperations {
  mkdirSync: typeof mkdirSync;
  openSync: typeof openSync;
  writeFileSync: typeof writeFileSync;
  fsyncSync: typeof fsyncSync;
  closeSync: typeof closeSync;
  renameSync: typeof renameSync;
  unlinkSync: typeof unlinkSync;
}

export interface AtomicWriteOptions {
  /** Internal original Source custody; this grants no filesystem permission. */
  sourceContext?: object;
  operations?: Partial<AtomicFileOperations>;
  platform?: NodeJS.Platform;
  tempName?: string;
  /** Protected publication barrier: unsupported directory flush is a hard failure. */
  requireDirectorySync?: boolean;
}

export type AtomicWriteFile = (
  targetPath: string,
  contents: string,
  options?: AtomicWriteOptions,
) => void;

const defaultOperations: AtomicFileOperations = {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
};

function sourceOperations(context:object):AtomicFileOperations {
  assertSourceSyncCustodyContext(context);
  return {
    mkdirSync:(...args:Parameters<typeof mkdirSync>)=>invokeSourceSyncSdk(context,'mkdir',defaultOperations.mkdirSync,args),
    openSync:(...args:Parameters<typeof openSync>)=>{
      const kind=args[1]==='r'?'fd-open-read':'fd-open';
      const fd=invokeSourceSyncSdk(context,kind,defaultOperations.openSync,args) as number;
      // Record the acquired descriptor's inode before writes or cleanup.
      try{invokeSourceSyncSdk(context,'fd-stat',nativeFstat,[fd]);}catch(error){try{invokeSourceSyncSdk(context,'fd-close',defaultOperations.closeSync,[fd]);}catch(cleanupError){throw new NativeAggregateError([error,cleanupError],'source_atomic_open_and_close_failed',{cause:error});}throw error;}return fd;
    },
    writeFileSync:(...args:Parameters<typeof writeFileSync>)=>invokeSourceSyncSdk(context,'void',defaultOperations.writeFileSync,args),
    fsyncSync:(...args:Parameters<typeof fsyncSync>)=>invokeSourceSyncSdk(context,'void',defaultOperations.fsyncSync,args),
    closeSync:(...args:Parameters<typeof closeSync>)=>invokeSourceSyncSdk(context,'fd-close',defaultOperations.closeSync,args),
    renameSync:(...args:Parameters<typeof renameSync>)=>invokeSourceSyncSdk(context,'rename-temp',defaultOperations.renameSync,args),
    unlinkSync:(...args:Parameters<typeof unlinkSync>)=>invokeSourceSyncSdk(context,'unlink-temp',defaultOperations.unlinkSync,args),
  } as AtomicFileOperations;
}
function appendError(errors:unknown[],error:unknown):void {
  define(errors,String(errors.length),{__proto__:null,value:error,enumerable:true,configurable:true,writable:true} as PropertyDescriptor);
}

const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set([
  'EINVAL',
  'ENOTSUP',
  'EISDIR',
]);

export const writeFileAtomicallySync: AtomicWriteFile = (
  targetPath,
  contents,
  options = {},
) => {
  const context=options.sourceContext;
  if(context!==undefined){assertSourceSyncCustodyContext(context);if(options.operations!==undefined||options.tempName!==undefined||options.platform!==undefined&&options.platform!==nativePlatform)throw Error('SOURCE_ATOMIC_ORIGINAL_IO_REQUIRED');}
  const platform = context===undefined?(options.platform ?? process.platform):nativePlatform;
  if (options.requireDirectorySync && platform === 'win32') {
    throw new Error('directory sync durability unsupported on Windows');
  }
  const operations = context===undefined?{
    ...defaultOperations,
    ...options.operations,
  }:sourceOperations(context);
  const parentDir = dirname(targetPath);
  const tempPath = join(
    parentDir,
    options.tempName
      ?? `.${basename(targetPath)}.${context===undefined?process.pid:nativePid}.${context===undefined?randomUUID():invokeSourceSyncSdk(context,'uuid',nativeUuid,[])}.tmp`,
  );
  operations.mkdirSync(parentDir, { recursive: true });

  let fileDescriptor: number | undefined;
  let renamed = false;
  let closeAttempted=false;
  try {
    fileDescriptor = operations.openSync(tempPath, 'wx', 0o600);
    operations.writeFileSync(fileDescriptor, contents, 'utf8');
    operations.fsyncSync(fileDescriptor);
    closeAttempted=true;operations.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    operations.renameSync(tempPath, targetPath);
    renamed = true;
    if (options.requireDirectorySync) syncDirectoryTreeStrict(parentDir, context===undefined?{ operations, platform }:{sourceContext:context,platform});
    else syncDirectory(parentDir, operations, platform,false,context);
  } catch (error) {
    const failures:unknown[]=[];
    if (fileDescriptor !== undefined&&(context===undefined||!closeAttempted)) {
      try {
        operations.closeSync(fileDescriptor);
      } catch (cleanupError) {if(context!==undefined)appendError(failures,cleanupError);}
    }
    if (!renamed) {
      try {
        operations.unlinkSync(tempPath);
      } catch (cleanupError) {if(context!==undefined)appendError(failures,cleanupError);}
    }
    if(failures.length)throw new NativeAggregateError([error,...failures],'source_atomic_write_and_cleanup_failed',{cause:error});
    throw error;
  }
};

/** A publication barrier, not a best-effort durability hint. Failures must propagate. */
export function syncDirectoryTreeStrict(directoryPath: string, options: Pick<AtomicWriteOptions, 'operations' | 'platform'|'sourceContext'> = {}): void {
  const context=options.sourceContext;
  if(context!==undefined){assertSourceSyncCustodyContext(context);if(options.operations!==undefined||options.platform!==undefined&&options.platform!==nativePlatform)throw Error('SOURCE_ATOMIC_ORIGINAL_IO_REQUIRED');}
  const platform = context===undefined?(options.platform ?? process.platform):nativePlatform;
  if (platform === 'win32') throw new Error('directory sync durability unsupported on Windows');
  const operations = context===undefined?{ ...defaultOperations, ...options.operations }:sourceOperations(context);
  let directory = resolve(directoryPath);
  for (;;) {
    syncDirectory(directory, operations, platform, true,context);
    const parent = dirname(directory); if (parent === directory) return;
    directory = parent;
  }
}

function syncDirectory(
  directoryPath: string,
  operations: AtomicFileOperations,
  platform: NodeJS.Platform,
  required = false,
  context?:object,
): void {
  if (platform === 'win32') {
    return;
  }

  let directoryDescriptor: number | undefined;
  let bodyFailure:{error:unknown}|undefined;
  try {
    directoryDescriptor = operations.openSync(directoryPath, 'r');
    operations.fsyncSync(directoryDescriptor);
  } catch (error) {
    const row=context!==undefined&&error&&typeof error==='object'&&!sourceIsProxy(error)?descriptor(error,'code'):undefined;
    const code = context===undefined?(error as NodeJS.ErrnoException).code:row&&own(row,'value')?row.value:undefined;
    if (required || !code || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(code)) {
      bodyFailure={error};
    }
  }
    if (directoryDescriptor !== undefined) {
      try{operations.closeSync(directoryDescriptor);}catch(error){if(bodyFailure&&context!==undefined)throw new NativeAggregateError([bodyFailure.error,error],'source_directory_sync_and_close_failed',{cause:bodyFailure.error});throw error;}
    }
  if(bodyFailure)throw bodyFailure.error;
}
