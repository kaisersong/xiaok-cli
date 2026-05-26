import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

const kswarmRoots = [
  process.env.KSWARM_SOURCE_ROOT ? resolve(process.env.KSWARM_SOURCE_ROOT) : null,
  join(repoRoot, 'kswarm'),
  join(repoRoot, '..', 'kswarm'),
].filter(Boolean);

const sourcePath = kswarmRoots
  .map((root) => join(root, 'scripts', 'auto-worker.js'))
  .find((path) => existsSync(path));
const targetPath = join(repoRoot, 'desktop', '.generated', 'kswarm', 'scripts', 'auto-worker.js');

if (!sourcePath) {
  const checkedPaths = kswarmRoots
    .map((root) => join(root, 'scripts', 'auto-worker.js'))
    .join(', ');
  throw new Error(`failed to locate kswarm auto-worker.js; checked: ${checkedPaths}`);
}

const force = process.env.XIAOK_FORCE_REGEN_OVERRIDES === '1';
if (!force && existsSync(targetPath)) {
  const sourceMtime = statSync(sourcePath).mtimeMs;
  const targetMtime = statSync(targetPath).mtimeMs;
  const generatorMtime = statSync(__filename).mtimeMs;
  if (targetMtime >= sourceMtime && targetMtime >= generatorMtime) {
    process.exit(0);
  }
}

const source = readFileSync(sourcePath, 'utf8');

const helperImport = "import { buildWindowsXiaokLaunchSpec } from './windows-xiaok-launch.js';";
if (source.includes(helperImport)) {
  throw new Error('upstream auto-worker.js already contains Windows xiaok helper import; update generator assumptions');
}

const lines = source.split('\n');
const lastImportIndex = lines.reduce((index, line, current) => (
  line.startsWith('import ') ? current : index
), -1);
if (lastImportIndex < 0) {
  throw new Error(`failed to locate import block in ${sourcePath}`);
}
lines.splice(lastImportIndex + 1, 0, helperImport);
const withImport = lines.join('\n');

const functionStart = withImport.indexOf('function runXiaok(binPath, prompt, model, workFolder) {');
const nextSection = withImport.indexOf("console.log(`[${ALIAS}] Starting agent: ${AGENT_ID}`);", functionStart);
if (functionStart < 0 || nextSection < 0) {
  throw new Error('failed to locate runXiaok block in upstream auto-worker.js');
}

const replacement = `function runXiaok(binPath, prompt, model, workFolder) {
  return new Promise((resolve, reject) => {
    const launch = buildWindowsXiaokLaunchSpec({
      runtimePath: binPath,
      prompt,
      model,
      workFolder,
      env: process.env,
    });
    if (!launch) {
      reject(new Error('local xiaok runtime not found on Windows'));
      return;
    }

    const cwd = workFolder && existsSync(workFolder) ? workFolder : process.cwd();
    const child = spawn(launch.command, launch.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(agentConfig.customEnv || {}) },
      timeout: CLI_TIMEOUT,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      const trimmedStdout = stdout.trim();
      let output = trimmedStdout;
      if (trimmedStdout) {
        try {
          const payload = JSON.parse(trimmedStdout);
          if (payload && typeof payload.text === 'string') {
            output = payload.text.trim();
          }
        } catch {
          output = trimmedStdout;
        }
      }

      if (code !== 0 && !output) {
        reject(new Error(\`xiaok exited \${code}: \${stderr.slice(0, 200)}\`));
      } else {
        resolve(output.trim() || \`(xiaok exited \${code})\`);
      }
    });

    child.on('error', (err) => reject(err));
  });
}

`;

const patched = withImport.slice(0, functionStart) + replacement + withImport.slice(nextSection);

mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, patched, 'utf8');
