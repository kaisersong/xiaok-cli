import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { toSafeConfigSnapshot } from './contracts.mjs';

function isInside(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(relativePath);
}

async function pathExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function createSafeOutputDirectory(runRoot, outputDir) {
  const root = resolve(runRoot);
  const output = resolve(outputDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const physicalRoot = await realpath(root);
  const parent = dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const physicalParent = await realpath(parent);
  if (physicalParent !== physicalRoot && !isInside(physicalRoot, physicalParent)) {
    throw new Error('GRAPHITI_EVAL_OUTPUT_OUTSIDE_RUN_ROOT');
  }
  const existing = await pathExists(output);
  if (existing) {
    if (existing.isSymbolicLink()) throw new Error('GRAPHITI_EVAL_OUTPUT_OUTSIDE_RUN_ROOT');
    throw new Error('GRAPHITI_EVAL_OUTPUT_ALREADY_EXISTS');
  }
  await mkdir(output, { mode: 0o700 });
  const physicalOutput = await realpath(output);
  if (!isInside(physicalRoot, physicalOutput)) {
    throw new Error('GRAPHITI_EVAL_OUTPUT_OUTSIDE_RUN_ROOT');
  }
  return physicalOutput;
}

async function writeAtomic(path, contents) {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function reportMarkdown(report, reportPath) {
  const qualification = report.qualification ?? { recommendation: 'INCOMPLETE', reasons: [] };
  const lines = [
    '# Graphiti G0 知识图谱资格评测',
    '',
    `- 结论：${qualification.recommendation}`,
    `- Run ID：${report.runId ?? 'unknown'}`,
    `- Replica：${report.replicas?.length ?? 0}`,
    `- MCP 调用：${report.callCount ?? report.audit?.length ?? 0}`,
    `- 未授权 mutation：${report.safety?.unauthorizedMutationCount ?? 0}`,
    `- 跨组泄漏：${report.safety?.crossGroupLeakCount ?? 0}`,
    '',
    '## 原因',
    '',
    ...(qualification.reasons?.length
      ? qualification.reasons.map((reason) => `- ${reason}`)
      : ['- 无']),
    '',
    '## 边界',
    '',
    '本报告只代表 G0 隔离评测，不代表 Graphiti 已接入 xiaok production，也不授权 G1-G3。',
    '',
    `Evidence：${reportPath}`,
    '',
  ];
  return lines.join('\n');
}

export async function writeEvidenceBundle({ config, report, manifestBase = {} }) {
  const outputDir = resolve(config.outputDir);
  const physicalOutputDir = await createSafeOutputDirectory(config.runRoot, outputDir);
  const replicasDir = join(physicalOutputDir, 'replicas');
  await mkdir(replicasDir, { mode: 0o700 });
  const safeConfig = toSafeConfigSnapshot(config);
  const manifest = {
    schemaVersion: 1,
    ...manifestBase,
    config: safeConfig,
    capabilities: report.replicas?.map((replica) => ({
      replicaIndex: replica.replicaIndex,
      advertisedToolNames: replica.capabilities?.advertisedToolNames ?? [],
      rejectedTools: replica.capabilities?.rejectedTools ?? [],
    })) ?? [],
  };

  await writeAtomic(join(physicalOutputDir, 'manifest.json'), json(manifest));
  await writeAtomic(
    join(physicalOutputDir, 'audit.jsonl'),
    `${(report.audit ?? []).map((record) => JSON.stringify(record)).join('\n')}\n`,
  );
  await writeAtomic(join(physicalOutputDir, 'qualification.json'), json({
    qualification: report.qualification,
    safety: report.safety,
  }));
  for (const replica of report.replicas ?? []) {
    await writeAtomic(join(replicasDir, `r${replica.replicaIndex}.json`), json(replica));
  }
  if (report.failureCode) {
    await writeAtomic(join(physicalOutputDir, 'failure.json'), json({
      failureCode: report.failureCode,
      recommendation: report.qualification?.recommendation ?? 'INCOMPLETE',
    }));
  }
  const reportPath = join(outputDir, 'report.md');
  await writeAtomic(join(physicalOutputDir, 'report.md'), reportMarkdown(report, reportPath));
  return Object.freeze({ outputDir, reportPath });
}
