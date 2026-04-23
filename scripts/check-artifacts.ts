import { checkArtifactSmoke, type ArtifactSmokeKind } from '../src/quality/artifact-smoke.js';

function main(): void {
  const args = process.argv.slice(2);
  const artifactPaths: string[] = [];
  const sourcePaths: string[] = [];
  let expectedKind: ArtifactSmokeKind = 'auto';
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) {
      continue;
    }
    if (value === '--source') {
      const source = args[index + 1];
      if (!source) {
        throw new Error('--source requires a path');
      }
      sourcePaths.push(source);
      index += 1;
      continue;
    }
    if (value === '--kind') {
      const kind = args[index + 1];
      if (!kind) {
        throw new Error('--kind requires a value');
      }
      expectedKind = kind as ArtifactSmokeKind;
      index += 1;
      continue;
    }
    if (value === '--json') {
      json = true;
      continue;
    }
    artifactPaths.push(value);
  }

  if (artifactPaths.length === 0) {
    throw new Error('usage: node --import tsx scripts/check-artifacts.ts <artifact-path> [more paths] [--source <path>] [--kind <kind>] [--json]');
  }

  const results = artifactPaths.map((artifactPath) => checkArtifactSmoke({
    artifactPath,
    sourcePaths,
    expectedKind,
  }));

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      if (result.ok) {
        console.log(`PASS ${result.artifactPath} (${result.kind}, ${result.sizeBytes} bytes)`);
      } else {
        console.log(`FAIL ${result.artifactPath} (${result.kind})`);
        for (const error of result.errors) {
          console.log(`- ${error}`);
        }
      }
    }
  }

  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
