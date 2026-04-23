import {
  writeRegressionRecord,
  type RegressionEvidenceKind,
  type RegressionKind,
  type RegressionSource,
  type RegressionSuggestedLayer,
} from '../src/quality/regression-capture.js';

function main(): void {
  const args = process.argv.slice(2);
  const evidence: Array<{ kind: RegressionEvidenceKind; value: string }> = [];
  let id: string | undefined;
  let title: string | undefined;
  let summary: string | undefined;
  let kind: RegressionKind | undefined;
  let source: RegressionSource | undefined;
  let suggestedLayer: RegressionSuggestedLayer | undefined;
  let outputDir: string | undefined;
  let overwrite = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) {
      continue;
    }
    if (value === '--id') {
      id = requireValue(args, ++index, '--id');
      continue;
    }
    if (value === '--title') {
      title = requireValue(args, ++index, '--title');
      continue;
    }
    if (value === '--summary') {
      summary = requireValue(args, ++index, '--summary');
      continue;
    }
    if (value === '--kind') {
      kind = requireValue(args, ++index, '--kind') as RegressionKind;
      continue;
    }
    if (value === '--source') {
      source = requireValue(args, ++index, '--source') as RegressionSource;
      continue;
    }
    if (value === '--layer') {
      suggestedLayer = requireValue(args, ++index, '--layer') as RegressionSuggestedLayer;
      continue;
    }
    if (value === '--dir') {
      outputDir = requireValue(args, ++index, '--dir');
      continue;
    }
    if (value === '--evidence') {
      const encoded = requireValue(args, ++index, '--evidence');
      const separator = encoded.indexOf(':');
      if (separator <= 0 || separator === encoded.length - 1) {
        throw new Error('--evidence expects kind:value');
      }
      evidence.push({
        kind: encoded.slice(0, separator) as RegressionEvidenceKind,
        value: encoded.slice(separator + 1),
      });
      continue;
    }
    if (value === '--overwrite') {
      overwrite = true;
      continue;
    }
    throw new Error(`unknown argument: ${value}`);
  }

  if (!title || !summary || !kind || !source || !suggestedLayer) {
    throw new Error(
      'usage: node --import tsx scripts/capture-regression.ts --title <title> --summary <summary> --kind <kind> --source <source> --layer <layer> [--id <id>] [--evidence kind:value] [--dir <dir>] [--overwrite]',
    );
  }

  const result = writeRegressionRecord({
    id,
    title,
    summary,
    kind,
    source,
    suggestedLayer,
    evidence,
    outputDir,
    overwrite,
  });

  console.log(result.path);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
