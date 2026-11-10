#ifndef XIAOK_ROOT_POOL_ADOPTION_RECORD_H
#define XIAOK_ROOT_POOL_ADOPTION_RECORD_H
#include "root-pool-adoption-codec.h"
#include "../main-installation/enrollment-codec.h"
#define NR_POOL_ADOPTION_RECORD_BYTES 1088
#define NR_POOL_ADOPTION_RECORD_NAME "adoption.bin"
typedef struct nr_pool_adoption_record {
  nr_original_pool_history history;
  nr_pool_migration_fuse fuse;
  unsigned char accepted_digest[32], planned[MI_ENROLLMENT_CONSUME_BYTES];
} nr_pool_adoption_record;
/* A deterministic relation identifier, not a secret or a Source capability. */
static int nr_pool_adoption_claim_id(const unsigned char accepted[32],
                                     const nr_pool_migration_fuse *v, unsigned char out[32]) {
  if (!accepted || !v || !out || !nr_adopt_nonzero(accepted, 32) ||
      !nr_adopt_nonzero(v->operation_id, 32) || !nr_adopt_nonzero(v->namespace_id, 32) ||
      !nr_adopt_nonzero(v->birth_id, 32) || !nr_adopt_nonzero(v->pool_id, 32))
    return 0;
  static const char domain[] = "xiaok-original-root-adoption-claim-v1";
  CC_SHA256_CTX hash;
  return CC_SHA256_Init(&hash) && CC_SHA256_Update(&hash, domain, sizeof(domain)) &&
         CC_SHA256_Update(&hash, accepted, 32) && CC_SHA256_Update(&hash, v->operation_id, 32) &&
         CC_SHA256_Update(&hash, v->namespace_id, 32) && CC_SHA256_Update(&hash, v->birth_id, 32) &&
         CC_SHA256_Update(&hash, v->pool_id, 32) && CC_SHA256_Final(out, &hash);
}
static int nr_pool_adoption_record_digest(const unsigned char *wire, unsigned char out[32]) {
  static const char domain[] = "xiaok-original-root-adoption-record-v1";
  CC_SHA256_CTX hash;
  return CC_SHA256_Init(&hash) && CC_SHA256_Update(&hash, domain, sizeof(domain)) &&
         CC_SHA256_Update(&hash, wire, 1056) && CC_SHA256_Final(out, &hash);
}
static int nr_pool_adoption_record_bindings(const nr_pool_adoption_record *v,
                                            uint32_t expected_kind) {
  if (!v || !nr_original_pool_history_valid(&v->history) ||
      !nr_pool_migration_fuse_valid(&v->fuse) || !nr_adopt_nonzero(v->accepted_digest, 32))
    return 0;
  const nr_pool_migration_fuse *f = &v->fuse;
  const nr_original_pool_history *h = &v->history;
  if (h->main_principal_uid != f->principal_uid || memcmp(h->pool_id, f->pool_id, 32) ||
      h->database.device != f->database_device || h->database.inode != f->database_inode ||
      h->issuer_lock.device != f->issuer_device || h->issuer_lock.inode != f->issuer_inode ||
      h->directory.device != f->directory_device || h->directory.inode != f->directory_inode)
    return 0;
  unsigned char claim[32];
  mi_enrollment_consume plan;
  if (!nr_pool_adoption_claim_id(v->accepted_digest, f, claim) || memcmp(claim, f->claim_id, 32) ||
      !mi_enrollment_decode_consume(v->planned, sizeof(v->planned), expected_kind, &plan))
    return 0;
  return plan.uid == h->main_principal_uid && !memcmp(plan.hashes[0], f->operation_id, 32) &&
         !memcmp(plan.hashes[1], v->accepted_digest, 32) &&
         !memcmp(plan.hashes[2], f->namespace_id, 32) && !memcmp(plan.hashes[3], f->birth_id, 32) &&
         !memcmp(plan.hashes[4], h->pool_id, 32);
}
static int nr_pool_adoption_record_encode(const nr_original_pool_history *history,
                                          const nr_pool_migration_fuse *fuse,
                                          const unsigned char accepted[32],
                                          const unsigned char planned[MI_ENROLLMENT_CONSUME_BYTES],
                                          uint32_t expected_kind,
                                          unsigned char out[NR_POOL_ADOPTION_RECORD_BYTES]) {
  if (!history || !fuse || !accepted || !planned || !out)
    return 0;
  nr_pool_adoption_record value = {0};
  value.history = *history;
  value.fuse = *fuse;
  memcpy(value.accepted_digest, accepted, 32);
  memcpy(value.planned, planned, sizeof(value.planned));
  if (!nr_pool_adoption_record_bindings(&value, expected_kind))
    return 0;
  memset(out, 0, NR_POOL_ADOPTION_RECORD_BYTES);
  memcpy(out, "XMADP001", 8);
  nr_adopt_put32(out + 8, 1);
  nr_adopt_put32(out + 12, NR_POOL_ADOPTION_RECORD_BYTES);
  nr_adopt_put32(out + 16, history->main_principal_uid);
  memcpy(out + 32, accepted, 32);
  if (!nr_original_pool_history_encode(history, out + 64) ||
      !nr_pool_migration_fuse_encode(fuse, out + 200))
    return 0;
  memcpy(out + 712, planned, MI_ENROLLMENT_CONSUME_BYTES);
  return nr_pool_adoption_record_digest(out, out + 1056);
}
static int nr_pool_adoption_record_decode(const unsigned char *p, size_t n, uint32_t expected_kind,
                                          nr_pool_adoption_record *out) {
  if (!p || !out || n != NR_POOL_ADOPTION_RECORD_BYTES || memcmp(p, "XMADP001", 8) ||
      nr_adopt_get32(p + 8) != 1 || nr_adopt_get32(p + 12) != NR_POOL_ADOPTION_RECORD_BYTES)
    return 0;
  for (int i = 20; i < 32; i++)
    if (p[i])
      return 0;
  for (int i = 1032; i < 1056; i++)
    if (p[i])
      return 0;
  unsigned char digest[32];
  if (!nr_pool_adoption_record_digest(p, digest) || memcmp(digest, p + 1056, 32))
    return 0;
  nr_pool_adoption_record v = {0};
  memcpy(v.accepted_digest, p + 32, 32);
  memcpy(v.planned, p + 712, sizeof(v.planned));
  if (!nr_original_pool_history_decode(p + 64, NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES, &v.history) ||
      !nr_pool_migration_fuse_decode(p + 200, NR_POOL_MIGRATION_FUSE_BYTES, &v.fuse) ||
      nr_adopt_get32(p + 16) != v.history.main_principal_uid ||
      !nr_pool_adoption_record_bindings(&v, expected_kind))
    return 0;
  *out = v;
  return 1;
}
#endif
