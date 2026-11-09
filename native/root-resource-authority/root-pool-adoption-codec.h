#ifndef XIAOK_ROOT_POOL_ADOPTION_CODEC_H
#define XIAOK_ROOT_POOL_ADOPTION_CODEC_H
/* Fixed data codec only. A hash or decoded tuple cannot mint Source/IO/claim. */
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <sys/stat.h>
#include <CommonCrypto/CommonDigest.h>
#include "root-store-io.h"
#define NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES 136
#define NR_POOL_MIGRATION_FUSE_BYTES 512
#define NR_POOL_MIGRATION_FUSE_NAME "root-resource-migration.fuse"
typedef struct nr_pool_migration_fuse {
  uint32_t principal_uid;
  uint64_t database_device, database_inode, issuer_device, issuer_inode, directory_device,
      directory_inode;
  unsigned char pool_id[32], operation_id[32], claim_id[32], namespace_id[32], birth_id[32];
} nr_pool_migration_fuse;
static inline void nr_adopt_put32(unsigned char *p, uint32_t n) {
  for (int i = 3; i >= 0; i--) {
    p[i] = (unsigned char)n;
    n >>= 8;
  }
}
static inline void nr_adopt_put64(unsigned char *p, uint64_t n) {
  for (int i = 7; i >= 0; i--) {
    p[i] = (unsigned char)n;
    n >>= 8;
  }
}
static inline uint32_t nr_adopt_get32(const unsigned char *p) {
  uint32_t n = 0;
  for (int i = 0; i < 4; i++)
    n = (n << 8) | p[i];
  return n;
}
static inline uint64_t nr_adopt_get64(const unsigned char *p) {
  uint64_t n = 0;
  for (int i = 0; i < 8; i++)
    n = (n << 8) | p[i];
  return n;
}
static inline int nr_adopt_nonzero(const unsigned char *p, size_t n) {
  unsigned char bits = 0;
  for (size_t i = 0; i < n; i++)
    bits |= p[i];
  return bits != 0;
}
static inline void nr_adopt_encode_fact(unsigned char *p, const nr_root_file_fact *f) {
  nr_adopt_put64(p, f->device);
  nr_adopt_put64(p + 8, f->inode);
  nr_adopt_put32(p + 16, f->uid);
  nr_adopt_put32(p + 20, f->mode);
  nr_adopt_put64(p + 24, f->nlink);
}
static inline void nr_adopt_decode_fact(const unsigned char *p, nr_root_file_fact *f) {
  f->device = nr_adopt_get64(p);
  f->inode = nr_adopt_get64(p + 8);
  f->uid = nr_adopt_get32(p + 16);
  f->mode = nr_adopt_get32(p + 20);
  f->nlink = nr_adopt_get64(p + 24);
}
static inline int nr_original_pool_history_valid(const nr_original_pool_history *v) {
  if (!v || !nr_adopt_nonzero(v->pool_id, 32))
    return 0;
  const nr_root_file_fact *facts[] = {&v->directory, &v->database, &v->issuer_lock};
  for (int i = 0; i < 3; i++) {
    const nr_root_file_fact *f = facts[i];
    if (!f->device || !f->inode || f->uid != v->main_principal_uid || !f->nlink)
      return 0;
    if (i ? (!S_ISREG(f->mode) || f->nlink != 1 || (f->mode & 07777) != 0600)
          : (!S_ISDIR(f->mode) || (f->mode & 07777) != 0700))
      return 0;
  }
  return 1;
}
static inline int nr_original_pool_history_encode(const nr_original_pool_history *v,
                                           unsigned char out[NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES]) {
  if (!out || !nr_original_pool_history_valid(v))
    return 0;
  memset(out, 0, NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES);
  memcpy(out, v->pool_id, 32);
  nr_adopt_put32(out + 32, v->main_principal_uid);
  nr_adopt_encode_fact(out + 40, &v->directory);
  nr_adopt_encode_fact(out + 72, &v->database);
  nr_adopt_encode_fact(out + 104, &v->issuer_lock);
  return 1;
}
static inline int nr_original_pool_history_decode(const unsigned char *p, size_t n,
                                           nr_original_pool_history *out) {
  if (!p || !out || n != NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES || nr_adopt_get32(p + 36))
    return 0;
  nr_original_pool_history v = {0};
  memcpy(v.pool_id, p, 32);
  v.main_principal_uid = nr_adopt_get32(p + 32);
  nr_adopt_decode_fact(p + 40, &v.directory);
  nr_adopt_decode_fact(p + 72, &v.database);
  nr_adopt_decode_fact(p + 104, &v.issuer_lock);
  if (!nr_original_pool_history_valid(&v))
    return 0;
  *out = v;
  return 1;
}
static inline int nr_pool_migration_fuse_valid(const nr_pool_migration_fuse *v) {
  return v && v->database_device && v->database_inode && v->issuer_device && v->issuer_inode &&
         v->directory_device && v->directory_inode && nr_adopt_nonzero(v->pool_id, 32) &&
         nr_adopt_nonzero(v->operation_id, 32) && nr_adopt_nonzero(v->claim_id, 32) &&
         nr_adopt_nonzero(v->namespace_id, 32) && nr_adopt_nonzero(v->birth_id, 32);
}
static inline int nr_pool_migration_fuse_encode(const nr_pool_migration_fuse *v,
                                         unsigned char out[NR_POOL_MIGRATION_FUSE_BYTES]) {
  if (!out || !nr_pool_migration_fuse_valid(v))
    return 0;
  memset(out, 0, NR_POOL_MIGRATION_FUSE_BYTES);
  memcpy(out, "XRNMF001", 8);
  nr_adopt_put32(out + 8, 1);
  nr_adopt_put32(out + 12, NR_POOL_MIGRATION_FUSE_BYTES);
  nr_adopt_put32(out + 16, v->principal_uid);
  nr_adopt_put64(out + 24, v->database_device);
  nr_adopt_put64(out + 32, v->database_inode);
  memcpy(out + 40, v->pool_id, 32);
  memcpy(out + 72, v->operation_id, 32);
  memcpy(out + 104, v->claim_id, 32);
  memcpy(out + 136, v->namespace_id, 32);
  memcpy(out + 168, v->birth_id, 32);
  nr_adopt_put64(out + 200, v->issuer_device);
  nr_adopt_put64(out + 208, v->issuer_inode);
  nr_adopt_put64(out + 216, v->directory_device);
  nr_adopt_put64(out + 224, v->directory_inode);
  return CC_SHA256(out, 480, out + 480) != NULL;
}
static inline int nr_pool_migration_fuse_decode(const unsigned char *p, size_t n,
                                         nr_pool_migration_fuse *out) {
  if (!p || !out || n != NR_POOL_MIGRATION_FUSE_BYTES || memcmp(p, "XRNMF001", 8) ||
      nr_adopt_get32(p + 8) != 1 || nr_adopt_get32(p + 12) != NR_POOL_MIGRATION_FUSE_BYTES ||
      nr_adopt_get32(p + 20))
    return 0;
  for (int i = 232; i < 480; i++)
    if (p[i])
      return 0;
  unsigned char digest[32];
  if (!CC_SHA256(p, 480, digest) || memcmp(digest, p + 480, 32))
    return 0;
  nr_pool_migration_fuse v = {0};
  v.principal_uid = nr_adopt_get32(p + 16);
  v.database_device = nr_adopt_get64(p + 24);
  v.database_inode = nr_adopt_get64(p + 32);
  memcpy(v.pool_id, p + 40, 32);
  memcpy(v.operation_id, p + 72, 32);
  memcpy(v.claim_id, p + 104, 32);
  memcpy(v.namespace_id, p + 136, 32);
  memcpy(v.birth_id, p + 168, 32);
  v.issuer_device = nr_adopt_get64(p + 200);
  v.issuer_inode = nr_adopt_get64(p + 208);
  v.directory_device = nr_adopt_get64(p + 216);
  v.directory_inode = nr_adopt_get64(p + 224);
  if (!nr_pool_migration_fuse_valid(&v))
    return 0;
  *out = v;
  return 1;
}
#endif
