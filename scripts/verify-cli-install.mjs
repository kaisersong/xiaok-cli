import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const archive = process.argv[2];
const omitOptional = process.argv.includes('--omit-optional');
if (!archive || !process.env.npm_execpath) throw new Error('npm run verify:cli-install -- <packed .tgz>');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-cli-consumer-')));
const tarball = realpathSync(resolve(archive));
const env = { ...process.env };
// Test the consumer project's reviewed policy, not npm-run's inherited policy.
for (const key of Object.keys(env)) {
  if (/^npm_config_(allow_scripts|ignore_scripts|strict_allow_scripts|dangerously_allow_all_scripts)$/i.test(key)) delete env[key];
}
const npm = (args) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd: dir, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000,
});
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'xiaok-cli-install-check', private: true,
  allowScripts: { [`file:${tarball}`]: true, [`file:${relative(dir, tarball).replaceAll('\\', '/')}`]: true,
    'node-pty@1.1.0': true, 'better-sqlite3@13.0.3': true, 'nodejieba@3.5.8': true, 'onnxruntime-node@1.30.0': true },
}));
console.log(`Consumer evidence: ${dir}`);
const output = npm(['install', tarball, '--no-audit', '--no-fund', '--foreground-scripts',
  ...(omitOptional ? ['--omit=optional'] : [])]);
writeFileSync(join(dir, 'install.log'), output);
const tree = JSON.parse(npm(['ls', '--all', '--json']));
const forbidden = new Set(['inflight', 'npmlog', 'rimraf', 'glob', 'are-we-there-yet', 'gauge']);
function inspect(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    assert(!forbidden.has(name), `Deprecated consumer dependency remains: ${name}`);
    if (name === '@mapbox/node-pre-gyp') assert.equal(child.version, '2.0.3');
    inspect(child);
  }
}
inspect(tree);
const installed = join(dir, 'node_modules', 'xiaokcode');
const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
assert.equal(execFileSync(process.execPath, [join(installed, 'dist', 'index.js'), '--version'], {
  cwd: dir, encoding: 'utf8', timeout: 60_000,
}).trim(), manifest.version);
if (omitOptional) {
  const fallback = `import assert from 'node:assert/strict';
    import {pathToFileURL} from 'node:url';
    const segment=await import(pathToFileURL(${JSON.stringify(join(installed, 'dist', 'ai', 'memory', 'segment.js'))}));
    assert.equal(segment.segmentationAvailable(),false);
    assert.equal(segment.segmentChinese('南京市长江大桥'),'南京市长江大桥');`;
  execFileSync(process.execPath, ['--input-type=module', '--eval', fallback], { cwd: dir, timeout: 60_000 });
  console.log(JSON.stringify({ version: manifest.version, deprecatedDependencies: 0, optionalFallback: true, consumer: dir }));
  process.exit(0);
}
const probe = `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const installed=${JSON.stringify(installed)};
const require=createRequire(join(installed,'package.json'));
const segment=await import(pathToFileURL(join(installed,'dist','ai','memory','segment.js')));
assert.equal(segment.segmentationAvailable(),true,'native segmentation must be available');
assert.equal(segment.segmentChinese('南京市长江大桥'),'南京市 长江大桥');
assert.equal(segment.segmentQuery('自然语言处理'),'自然语言 处理');
const term=require('node-pty').spawn(process.execPath,['-e','process.stdout.write("CLI_NATIVE_PTY_OK")'],{name:'xterm-256color',cols:80,rows:24});
let output='';term.onData(data=>output+=data);
const timer=setTimeout(()=>{term.kill();process.exit(1);},10000);
term.onExit(({exitCode})=>{clearTimeout(timer);assert.equal(exitCode,0);assert(output.includes('CLI_NATIVE_PTY_OK'));console.log('Native segmentation and PTY passed');});
`;
console.log(execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
  cwd: dir, encoding: 'utf8', timeout: 60_000,
}).trim());
console.log(JSON.stringify({ version: manifest.version, deprecatedDependencies: 0, consumer: dir }));
