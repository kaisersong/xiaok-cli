import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const flavor = process.argv[2];
if (flavor !== 'normal' && flavor !== 'rollback') {
  throw new Error('build flavor must be normal or rollback');
}
const buildId = flavor === 'normal'
  ? 'xiaok-normal-kimi-k3-d8'
  : 'xiaok-rollback-kimi-k3-d8';
writeFileSync(
  resolve('src', 'build-flavor.ts'),
  `export const XIAOK_BUILD_FLAVOR = ${JSON.stringify(flavor)} as const;\n`
    + `export const XIAOK_BUILD_ID = ${JSON.stringify(buildId)} as const;\n`,
  'utf8',
);
