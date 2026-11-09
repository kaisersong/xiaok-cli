#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include "root-pool-adoption-codec.h"
int main(void) {
  nr_original_pool_history old = {0}, decoded = {0};
  old.main_principal_uid = 502;
  memset(old.pool_id, 1, 32);
  nr_root_file_fact *facts[] = {&old.directory, &old.database, &old.issuer_lock};
  for (int i = 0; i < 3; i++) {
    facts[i]->device = 0x0102030405060708ULL;
    facts[i]->inode = 100 + i;
    facts[i]->uid = 502;
    facts[i]->mode = (i ? S_IFREG : S_IFDIR) | (i ? 0600 : 0700);
    facts[i]->nlink = i ? 1 : 2;
  }
  unsigned char bytes[NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES];
  assert(nr_original_pool_history_encode(&old, bytes));
  assert(bytes[32] == 0 && bytes[33] == 0 && bytes[34] == 1 && bytes[35] == 246);
  for (int i = 0; i < 8; i++)
    assert(bytes[40 + i] == i + 1);
  assert(nr_original_pool_history_decode(bytes, sizeof(bytes), &decoded));
  assert(decoded.database.inode == 101 && decoded.directory.device == old.directory.device &&
         decoded.main_principal_uid == 502 && !memcmp(decoded.pool_id, old.pool_id, 32));
  bytes[36] = 1;
  assert(!nr_original_pool_history_decode(bytes, sizeof(bytes), &decoded));
  bytes[36] = 0;
  assert(!nr_original_pool_history_decode(bytes, sizeof(bytes) - 1, &decoded));
  nr_pool_migration_fuse tuple = {0}, out = {0};
  tuple.principal_uid = old.main_principal_uid;
  memcpy(tuple.pool_id, old.pool_id, 32);
  tuple.database_device = old.database.device;
  tuple.database_inode = old.database.inode;
  tuple.issuer_device = old.issuer_lock.device;
  tuple.issuer_inode = old.issuer_lock.inode;
  tuple.directory_device = old.directory.device;
  tuple.directory_inode = old.directory.inode;
  memset(tuple.operation_id, 2, 32);
  memset(tuple.claim_id, 3, 32);
  memset(tuple.namespace_id, 4, 32);
  memset(tuple.birth_id, 5, 32);
  unsigned char fuse[NR_POOL_MIGRATION_FUSE_BYTES];
  assert(nr_pool_migration_fuse_encode(&tuple, fuse));
  assert(fuse[24] == 1 && fuse[31] == 8 && fuse[32] == 0 && fuse[39] == 101);
  assert(nr_pool_migration_fuse_decode(fuse, sizeof(fuse), &out));
  assert(out.database_inode == 101 && !memcmp(out.pool_id, old.pool_id, 32) &&
         !memcmp(out.operation_id, tuple.operation_id, 32));
  fuse[479] = 1;
  assert(!nr_pool_migration_fuse_decode(fuse, sizeof(fuse), &out));
  puts("{\"kind\":\"actual-original-adoption-codec\",\"historyWireBytes\":136,\"fuseWireBytes\":"
       "512,\"bigEndianGoldenBytes\":true,\"productionQualification\":false}");
  return 0;
}
