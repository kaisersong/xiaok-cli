#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "root-store-io.h"
#include "root-store-io-dispatch.h"
int main(void) {
  uintptr_t old_table[16] = {0};
  old_table[0] = 1;
  assert(!nm_installed_import_root_store((const nm_root_store_dispatch *)old_table,
                                         (nr_root_store_io *)(uintptr_t)1));
  nm_root_store_dispatch wrong = {0};
  wrong.magic = NR_STORE_DISPATCH_MAGIC;
  wrong.version = NR_STORE_DISPATCH_VERSION + 1;
  wrong.bytes = sizeof(wrong);
  assert(!nm_installed_import_root_store(&wrong, (nr_root_store_io *)(uintptr_t)1));
  wrong.version = NR_STORE_DISPATCH_VERSION;
  wrong.bytes--;
  assert(!nm_installed_import_root_store(&wrong, (nr_root_store_io *)(uintptr_t)1));
  const nr_root_bootstrap_claim *claim = NULL;
  nr_original_pool_history history = {0};
  nr_root_store_identity identity = {0};
  nr_root_store_io *foreign = (nr_root_store_io *)(uintptr_t)1;
  const nr_root_bootstrap_claim *foreign_claim = (const nr_root_bootstrap_claim *)(uintptr_t)2;
  enum nr_root_adoption_kind kind = NR_ROOT_ORDINARY_BINDING;
  assert(!nr_root_store_read_adoption_kind(foreign, &kind));
  assert(!nr_root_store_claim_adopted(NULL, &claim));
  assert(!nr_root_store_claim_adopted(foreign, &claim));
  assert(claim == NULL);
  assert(!nr_root_store_read_adoption(foreign, foreign_claim, &history, &identity));
  assert(!nr_root_store_bind_bootstrap(foreign, NR_ADOPTION_COMMITTED, foreign_claim, &identity));
  puts("{\"kind\":\"actual-original-adoption-api-negative\",\"foreignIoBeforeDereference\":true,"
       "\"productionQualification\":false}");
  return 0;
}
