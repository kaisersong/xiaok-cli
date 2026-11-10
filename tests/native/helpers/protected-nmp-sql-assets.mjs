import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
// Exact original zero-count header from process-launch-intent.test.mjs. It
// enables original fixture write diagnostics, without supplying a subject.
export const PROTECTED_NMP_SQL_FINITE_FACTS_HEADER = 'static const char *nr_fixture_metadata[]={NULL};\nstatic const char *nr_fixture_execution_keys[]={NULL};\nstatic const int nr_fixture_priorities[]={0};\n#define NR_FIXTURE_FACT_COUNT 0\n';
export function getProtectedNmpSqlFixtureAssets() {
  const fragment=fileURLToPath(new URL('../fixtures/protected-nmp-sql-fragment.cjs',import.meta.url));
  return Object.freeze({fragment,fragmentSha256:createHash('sha256').update(readFileSync(fragment)).digest('hex'),finiteHeader:PROTECTED_NMP_SQL_FINITE_FACTS_HEADER,finiteHeaderSha256:createHash('sha256').update(PROTECTED_NMP_SQL_FINITE_FACTS_HEADER).digest('hex')});
}
