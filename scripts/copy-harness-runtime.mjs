import { copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'desktop', 'dist', 'main', 'desktop', 'electron');
mkdirSync(destination, { recursive: true });
copyFileSync(join(root, 'desktop', 'electron', 'harness-optimization-store-worker.mjs'), join(destination, 'harness-optimization-store-worker.mjs'));
for(const name of ['harness-dsh-budget-data.mjs','harness-dsh-budget-ledger.mjs','harness-dsh-work-escrow.mjs','harness-dsh-source-read-budget.mjs','harness-dsh-budget-conservative.mjs','harness-dsh-account-revision.mjs','harness-dsh-account-epoch.mjs','harness-dsh-draft-usage.mjs'])copyFileSync(join(root,'desktop','electron',name),join(destination,name));
const binary = join(root, 'native', 'harness-optimization-owner-lock', 'build', 'Release', 'harness_owner_lock.node');
const target = join(destination, 'harness_owner_lock.node');
if (existsSync(binary)) copyFileSync(binary, target);
else rmSync(target, { force: true });
const mainBootstrapBinary = join(root, 'native', 'root-resource-authority', 'build', 'Release', 'main_bootstrap.node');
const protectedSqliteBinary=join(root,'native','protected-sqlite-facade','build','Release','protected_sqlite.node');
if(existsSync(protectedSqliteBinary))copyFileSync(protectedSqliteBinary,join(destination,'protected_sqlite.node'));
else rmSync(join(destination,'protected_sqlite.node'),{force:true});
copyFileSync(join(root,'native','protected-sqlite-facade','index.cjs'),join(destination,'harness-protected-sqlite.cjs'));
const mainBootstrapTarget = join(destination, 'main_bootstrap.node');
if (existsSync(mainBootstrapBinary)) copyFileSync(mainBootstrapBinary, mainBootstrapTarget);
else rmSync(mainBootstrapTarget, { force: true });
const rootResourceBinary = join(root, 'native', 'root-resource-authority', 'build', 'Release', 'root_resource_authority.node');
const rootResourceTarget = join(destination, 'root_resource_authority.node');
if (existsSync(rootResourceBinary)) copyFileSync(rootResourceBinary, rootResourceTarget);
else rmSync(rootResourceTarget, { force: true });
const rootMainBinary = join(root, 'native', 'root-resource-authority', 'build', 'Release', 'root_resource_authority_main.node');
const rootMainTarget = join(destination, 'root_resource_authority_main.node');
if (existsSync(rootMainBinary)) copyFileSync(rootMainBinary, rootMainTarget);
else rmSync(rootMainTarget, { force: true });

// The Native v2 leaf executes only this build-bound bundled asset.
for (const name of ['readonly-leaf-driver.mjs', 'readonly-leaf-assets.json']) {
  const source = join(root, 'native', 'root-resource-authority', 'build', 'Release', name);
  const target = join(destination, name);
  if (existsSync(rootMainBinary) && existsSync(source)) copyFileSync(source, target);
  else rmSync(target, { force: true });
}
