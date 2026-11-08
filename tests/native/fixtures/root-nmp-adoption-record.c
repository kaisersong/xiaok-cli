#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include "root-pool-adoption-record.h"
int main(void) {
  nr_original_pool_history h = {0};
  h.main_principal_uid = 502;
  memset(h.pool_id, 1, 32);
  nr_root_file_fact *facts[] = {&h.directory, &h.database, &h.issuer_lock};
  for (int i = 0; i < 3; i++) {
    facts[i]->device = 10;
    facts[i]->inode = 100 + i;
    facts[i]->uid = 502;
    facts[i]->mode = (i ? S_IFREG : S_IFDIR) | (i ? 0600 : 0700);
    facts[i]->nlink = i ? 1 : 2;
  }
  nr_pool_migration_fuse f = {0};
  f.principal_uid = 502;
  f.database_device = 10;
  f.database_inode = 101;
  f.issuer_device = 10;
  f.issuer_inode = 102;
  f.directory_device = 10;
  f.directory_inode = 100;
  memcpy(f.pool_id, h.pool_id, 32);
  memset(f.operation_id, 2, 32);
  memset(f.namespace_id, 3, 32);
  memset(f.birth_id, 4, 32);
  unsigned char accepted[32];
  memset(accepted, 5, 32);
  assert(nr_pool_adoption_claim_id(accepted, &f, f.claim_id));
  mi_enrollment_consume c = {0};
  c.kind = 2;
  c.uid = 502;
  c.epoch = 1;
  for (int i = 0; i < 8; i++)
    memset(c.hashes[i], i + 1, 32);
  memcpy(c.hashes[0], f.operation_id, 32);
  memcpy(c.hashes[1], accepted, 32);
  memcpy(c.hashes[2], f.namespace_id, 32);
  memcpy(c.hashes[3], f.birth_id, 32);
  memcpy(c.hashes[4], h.pool_id, 32);
  unsigned char planned[MI_ENROLLMENT_CONSUME_BYTES];
  assert(mi_enrollment_encode_consume(&c, planned));
  unsigned char record[NR_POOL_ADOPTION_RECORD_BYTES];
  nr_pool_adoption_record decoded;
  assert(nr_pool_adoption_record_encode(&h, &f, accepted, planned, 2, record));
  assert(nr_pool_adoption_record_decode(record, sizeof(record), 2, &decoded));
  assert(!memcmp(decoded.planned, planned, sizeof(planned)));
  assert(decoded.history.database.inode == 101);
  record[1040] = 1;
  assert(!nr_pool_adoption_record_decode(record, sizeof(record), 2, &decoded));
  record[1040] = 0;
  assert(!nr_pool_adoption_record_decode(record, sizeof(record) - 1, 2, &decoded));
  assert(!nr_pool_adoption_record_decode(record, sizeof(record), 1, &decoded));
  puts("{\"kind\":\"actual-original-adoption-record\",\"recordBytes\":1088,"
       "\"plannedConsumeStable\":true,\"productionQualification\":false}");
  return 0;
}
