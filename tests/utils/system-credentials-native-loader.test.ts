import {afterEach, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const backendUrl = new URL('../../src/utils/system-credentials.js', import.meta.url).href;
const loaderUrl = new URL('../../src/utils/fixed-keyring-native.js', import.meta.url).href;
const roots: string[] = [];
const id = '00000000-0000-4000-8000-000000000001';
const packages = [
  'darwin-arm64', 'darwin-x64', 'win32-arm64-msvc', 'win32-x64-msvc',
  'win32-ia32-msvc', 'linux-arm64-gnu', 'linux-arm64-musl',
  'linux-x64-gnu', 'linux-x64-musl', 'freebsd-x64',
  'linux-arm-gnueabihf', 'linux-riscv64-gnu',
].map(value => '@napi-rs/keyring-' + value);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true, maxRetries: 3});
});

type Options = {
  mode?: 'backend' | 'file' | 'loader' | 'cached' | 'actual' | 'nested';
  platform?: string; arch?: string; report?: unknown; browser?: boolean;
  configVariables?: Record<string, unknown>; flags?: Record<string, string>;
  canary?: boolean; version?: string; getter?: boolean; proxy?: boolean;
};

function run(options: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-fixed-keyring-'));
  roots.push(root);
  const config = join(root, 'config');
  mkdirSync(config, {mode: 0o700});
  const marker = join(root, 'canary');
  const canary = join(root, 'override.cjs');
  writeFileSync(canary, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');
    module.exports={Entry:class {getPassword(){return 'fixture-canary'} setPassword(){}}};`);
  let activeLoaderUrl = loaderUrl;
  if (options.mode === 'nested') {
    const application = join(root, 'nested-app');
    const utils = join(application, 'utils');
    const core = join(application, 'node_modules', '@napi-rs', 'keyring');
    const target = join(core, 'node_modules', '@napi-rs', 'keyring-darwin-arm64');
    mkdirSync(utils, {recursive: true, mode: 0o700});
    mkdirSync(target, {recursive: true, mode: 0o700});
    const copied = join(utils, 'fixed-keyring-native.mjs');
    copyFileSync(fileURLToPath(loaderUrl), copied);
    writeFileSync(join(core, 'package.json'), JSON.stringify({name: '@napi-rs/keyring', version: '2.1.2'}));
    writeFileSync(join(target, 'package.json'), JSON.stringify({name: '@napi-rs/keyring-darwin-arm64', version: '2.1.2', main: 'fixture.cjs'}));
    writeFileSync(join(target, 'fixture.cjs'), 'module.exports={Entry:class Entry{}};');
    activeLoaderUrl = pathToFileURL(copied).href;
  }
  const env: NodeJS.ProcessEnv = {...process.env, XIAOK_CONFIG_DIR: config};
  for (const name of ['NAPI_RS_NATIVE_LIBRARY_PATH', 'NAPI_RS_FORCE_WASI', 'NAPI_RS_WASI_FLAVOR']) delete env[name];
  Object.assign(env, options.flags);
  if (options.mode === 'nested') env.NODE_PATH = '';
  if (options.canary) env.NAPI_RS_NATIVE_LIBRARY_PATH = canary;
  const program = `
    import Module from 'node:module';
    const options=${JSON.stringify(options)}, packages=new Set(${JSON.stringify(packages)});
    const state={requests:[],constructors:[],getterCalls:0,proxyTraps:0};
    if(options.platform)Object.defineProperty(process,'platform',{value:options.platform,configurable:true});
    if(options.arch)Object.defineProperty(process,'arch',{value:options.arch,configurable:true});
    if(options.browser)Object.defineProperty(process,'type',{value:'browser',configurable:true});
    if(options.report!==undefined)Object.defineProperty(process.report,'getReport',{value:()=>options.report,configurable:true});
    if(options.configVariables)Object.defineProperty(process,'config',{value:{variables:options.configVariables},configurable:true});
    const original=Module._load;
    class Entry {constructor(...args){state.constructors.push(args)}getPassword(){return 'fixture-credential'}setPassword(){}}
    if(options.mode!=='actual'&&options.mode!=='nested'&&!options.canary)Module._load=function(request,parent,isMain){
      const metadata=typeof request==='string'&&request.endsWith('/package.json')&&packages.has(request.slice(0,-13));
      if(metadata){state.requests.push(request);return {version:options.version??'2.1.2'}}
      if(request==='@napi-rs/keyring'||packages.has(request)){
        state.requests.push(request);
        if(options.getter)return Object.defineProperty({},'Entry',{get(){state.getterCalls++;return Entry}});
        if(options.proxy)return new Proxy({Entry},{getOwnPropertyDescriptor(){state.proxyTraps++;throw Error('proxy trap')}});
        return {Entry};
      }
      return Reflect.apply(original,this,[request,parent,isMain]);
    };
    try {
      const mode=options.mode??'backend';
      if(mode==='backend'||mode==='file'){
        const {systemCredentialBackend}=await import(${JSON.stringify(backendUrl)});
        const backend=systemCredentialBackend();
        if(mode==='file')backend.put(${JSON.stringify(id)},'fixture-file');
        state.value=backend.get(${JSON.stringify(id)});
      }else{
        const {loadFixedKeyringEntry}=await import(${JSON.stringify(activeLoaderUrl)});
        const Entry=loadFixedKeyringEntry();state.entryType=typeof Entry;
        if(mode==='cached'){
          state.before=state.requests.length;
          process.env.NAPI_RS_NATIVE_LIBRARY_PATH=${JSON.stringify(canary)};
          loadFixedKeyringEntry();
        }
      }
    }catch(error){state.error=error?.message??String(error)}
    console.log(JSON.stringify(state));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    env, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout.trim());
  let executed = false;
  try {executed = readFileSync(marker, 'utf8') === 'executed';} catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {...result, executed};
}

it('rejects a native path override through the real backend before executing its canary', () => {
  const result = run({canary: true});
  expect(result.error, JSON.stringify({executed: result.executed, valueWasCanary: result.value === 'fixture-canary'})).toBe('credential_store_unavailable');
  expect(result.executed).toBe(false);
  expect(result.value).toBeUndefined();
}, 20_000);

it.each([{NAPI_RS_FORCE_WASI: 'true'}, {NAPI_RS_FORCE_WASI: 'error'}, {NAPI_RS_WASI_FLAVOR: 'wasm32-wasi'}])(
  'rejects a WASI override before any fixed native require: %j', flags => {
    const result = run({flags});
    expect(result.error).toBe('credential_store_unavailable');
    expect(result.requests).toEqual([]);
    expect(result.constructors).toEqual([]);
  }, 20_000,
);

it('keeps actual default file reads and writes independent of native loader overrides', () => {
  const result = run({mode: 'file', flags: {NAPI_RS_NATIVE_LIBRARY_PATH: '/fixture-denied-native'}});
  expect(result.error).toBeUndefined();
  expect(result.value).toBe('fixture-file');
  expect(result.requests).toEqual([]);
  expect(result.constructors).toEqual([]);
}, 20_000);

const matrix = [
  ['darwin', 'arm64', undefined, 'darwin-arm64'],
  ['darwin', 'x64', undefined, 'darwin-x64'],
  ['win32', 'arm64', undefined, 'win32-arm64-msvc'],
  ['win32', 'x64', undefined, 'win32-x64-msvc'],
  ['win32', 'ia32', undefined, 'win32-ia32-msvc'],
  ['linux', 'arm64', {header: {glibcVersionRuntime: '2.36'}}, 'linux-arm64-gnu'],
  ['linux', 'arm64', {header: {}, sharedObjects: ['/lib/ld-musl-aarch64.so.1']}, 'linux-arm64-musl'],
  ['linux', 'x64', {header: {glibcVersionRuntime: '2.36'}}, 'linux-x64-gnu'],
  ['linux', 'x64', {header: {}, sharedObjects: ['/lib/libc.musl-x86_64.so.1']}, 'linux-x64-musl'],
  ['linux', 'arm', {header: {glibcVersionRuntime: '2.36'}}, 'linux-arm-gnueabihf'],
  ['linux', 'riscv64', {header: {glibcVersionRuntime: '2.36'}}, 'linux-riscv64-gnu'],
  ['freebsd', 'x64', undefined, 'freebsd-x64'],
] as const;

it.each(matrix)('uses only the fixed locked target for %s/%s (%j)', (platform, arch, report, suffix) => {
  const result = run({mode: 'loader', platform, arch, report});
  expect(result.error).toBeUndefined();
  expect(result.entryType).toBe('function');
  expect(result.requests).toEqual([
    '@napi-rs/keyring-' + suffix + '/package.json', '@napi-rs/keyring-' + suffix,
  ]);
  expect(result.constructors).toEqual([]);
}, 20_000);

it('preserves the original service, account and Linux backend arguments through the actual backend', () => {
  const result = run();
  expect(result.error).toBeUndefined();
  expect(result.value).toBe('fixture-credential');
  expect(result.constructors).toEqual([['com.xiaok.credentials.v1', id, {linux: {store: 'secret-service'}}]]);
  expect(result.requests).not.toContain('@napi-rs/keyring');
}, 20_000);

it('checks a new override even after the native package was cached', () => {
  const result = run({mode: 'cached'});
  expect(result.error).toMatch(/credential_/);
  expect(result.before).toBe(2);
  expect(result.requests).toHaveLength(2);
  expect(result.executed).toBe(false);
}, 20_000);

it('rejects a mismatched package version before loading the native binding', () => {
  const result = run({mode: 'loader', platform: 'darwin', arch: 'arm64', version: '9.9.9'});
  expect(result.error).toMatch(/credential_/);
  expect(result.requests).toEqual(['@napi-rs/keyring-darwin-arm64/package.json']);
  expect(result.constructors).toEqual([]);
}, 20_000);

it.each([{getter: true}, {proxy: true}])('rejects non-data Entry without running getters or Proxy traps: %j', shape => {
  const result = run({mode: 'loader', ...shape});
  expect(result.error).toMatch(/credential_/);
  expect(result.getterCalls).toBe(0);
  expect(result.proxyTraps).toBe(0);
  expect(result.constructors).toEqual([]);
}, 20_000);

it('retains Main refusal before considering an override or native module', () => {
  const result = run({mode: 'loader', browser: true, flags: {NAPI_RS_NATIVE_LIBRARY_PATH: '/fixture-denied-native'}});
  expect(result.error).toBe('credential_worker_required');
  expect(result.requests).toEqual([]);
}, 20_000);

it.each([
  {platform: 'aix', arch: 'ppc64'},
  {platform: 'linux', arch: 'x64', report: {header: {}, sharedObjects: []}},
  {platform: 'win32', arch: 'x64', configVariables: {shlib_suffix: 'dll.a'}},
  {platform: 'win32', arch: 'x64', configVariables: {node_target_type: 'shared_library'}},
])('refuses unsupported or unconfirmed platform facts without loading a target: %j', facts => {
  const result = run({mode: 'loader', ...facts});
  expect(result.error).toMatch(/credential_/);
  expect(result.requests).toEqual([]);
}, 20_000);

it('loads the actual host binding Entry without constructing it or reading a keychain item', () => {
  const result = run({mode: 'actual'});
  expect(result.error).toBeUndefined();
  expect(result.entryType).toBe('function');
  expect(result.constructors).toEqual([]);
}, 20_000);

// Uses real Node package resolution with a test-only SDK package, not a Native qualification claim.
it('resolves the fixed optional package inside its owning dependency without requiring hoisting', () => {
  const result = run({mode: 'nested', platform: 'darwin', arch: 'arm64'});
  expect(result.error).toBeUndefined();
  expect(result.entryType).toBe('function');
  expect(result.constructors).toEqual([]);
}, 20_000);
