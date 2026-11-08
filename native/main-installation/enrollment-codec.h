#ifndef XIAOK_MAIN_ROOT_ENROLLMENT_CODEC_H
#define XIAOK_MAIN_ROOT_ENROLLMENT_CODEC_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#endif
#if defined(__GNUC__)
#define MI_E_UNUSED __attribute__((unused))
#else
#define MI_E_UNUSED
#endif
/* Pure bytes, never Source/FD closure/Native approval or activation authority.
 * The original helper must independently validate its fixed producer/custody
 * before using a structurally valid record. No filesystem operation lives here. */
#define MI_ENROLLMENT_ACCEPTED_BYTES 2080u
#define MI_ENROLLMENT_CONSUME_BYTES 320u
#define MI_ENROLLMENT_HASH_COUNT 24u
#define MI_ENROLLMENT_FAMILY_HASH_COUNT 7u
enum {
  MI_E_AUTHORITY,
  MI_E_RELEASE,
  MI_E_MAIN,
  MI_E_CONTROLLER,
  MI_E_PROFILE,
  MI_E_OPERATION,
  MI_E_NAMESPACE,
  MI_E_BIRTH,
  MI_E_POOL,
  MI_E_WHOLE_SOURCE,
  MI_E_REVIEW,
  MI_E_APPROVAL,
  MI_E_COMMITTED_COMMAND,
  MI_E_ROOT_LEDGER,
  MI_E_OLD_WRITERS,
  MI_E_FLOOR_TRANSITION,
  MI_E_CLOCK_DOMAIN,
  MI_E_HISTORY,
  MI_E_POLICY,
  MI_E_PENDING_OPERATION,
  MI_E_PRIOR_ACCEPTED,
  MI_E_WITNESS,
  MI_E_BOOT_SESSION,
  MI_E_PUBLISHER_RELEASE
};
typedef struct mi_enrollment_fact {
  uint64_t device, inode, links;
  uint32_t uid, mode;
} mi_enrollment_fact;
typedef struct mi_enrollment_family {
  uint32_t id, rule, reader, mode;
  unsigned char hashes[MI_ENROLLMENT_FAMILY_HASH_COUNT][32];
} mi_enrollment_family;
typedef struct mi_enrollment_projection {
  uint32_t kind, uid, mode, source_schema, target_schema;
  uint64_t epoch, clock_epoch, not_before, valid_until, inventory_generation;
  unsigned char account[36], hashes[MI_ENROLLMENT_HASH_COUNT][32];
  mi_enrollment_fact facts[3];
  mi_enrollment_family families[4];
} mi_enrollment_projection;
typedef struct mi_enrollment_consume {
  uint32_t kind, uid;
  uint64_t epoch;
  /* operation, accepted digest, namespace, birth, original pool, Native nonce,
   * fixed publisher code digest, accepted file physical identity binding. */
  unsigned char hashes[8][32];
} mi_enrollment_consume;
static const uint16_t mi_e_hash_offsets[MI_ENROLLMENT_HASH_COUNT] = {
    32,  64,  96,  128, 200, 232, 264, 296, 328, 360, 392, 424,
    456, 488, 520, 552, 600, 656, 792, 832, 864, 896, 928, 960};
static MI_E_UNUSED uint32_t mi_e_u32(const unsigned char *p) {
  return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
static MI_E_UNUSED uint64_t mi_e_u64(const unsigned char *p) {
  uint64_t n = 0;
  for (int i = 0; i < 8; i++)
    n = n << 8 | p[i];
  return n;
}
static MI_E_UNUSED void mi_e_p32(unsigned char *p, uint32_t n) {
  for (int i = 3; i >= 0; i--) {
    p[i] = (unsigned char)n;
    n >>= 8;
  }
}
static MI_E_UNUSED void mi_e_p64(unsigned char *p, uint64_t n) {
  for (int i = 7; i >= 0; i--) {
    p[i] = (unsigned char)n;
    n >>= 8;
  }
}
static MI_E_UNUSED int mi_e_nonzero(const unsigned char *p, size_t n) {
  unsigned v = 0;
  for (size_t i = 0; i < n; i++)
    v |= p[i];
  return v != 0;
}
static MI_E_UNUSED int mi_e_hash(const char *domain, size_t domain_size, const unsigned char *bytes,
                                 size_t n, unsigned char out[32]) {
#ifdef __APPLE__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CC_SHA256_CTX h;
  int good = CC_SHA256_Init(&h) && CC_SHA256_Update(&h, domain, (CC_LONG)domain_size) &&
             CC_SHA256_Update(&h, bytes, (CC_LONG)n) && CC_SHA256_Final(out, &h);
#pragma clang diagnostic pop
  return good;
#else
  (void)domain;
  (void)domain_size;
  (void)bytes;
  (void)n;
  (void)out;
  return 0;
#endif
}
static MI_E_UNUSED int mi_e_projection_checksum(const unsigned char *bytes, unsigned char out[32]) {
  static const char domain[] = "xiaok-main-root-accepted-projection-v1";
  return mi_e_hash(domain, sizeof(domain), bytes, 2048, out);
}
static MI_E_UNUSED int mi_e_consume_checksum(const unsigned char *bytes, unsigned char out[32]) {
  static const char domain[] = "xiaok-main-root-consume-receipt-v1";
  return mi_e_hash(domain, sizeof(domain), bytes, 288, out);
}
static MI_E_UNUSED int mi_e_account(const unsigned char p[36]) {
  for (size_t i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (p[i] != '-')
        return 0;
    } else if (!((p[i] >= '0' && p[i] <= '9') || (p[i] >= 'A' && p[i] <= 'F')))
      return 0;
  }
  return 1;
}
static MI_E_UNUSED int mi_e_projection_valid(const mi_enrollment_projection *p) {
  if (!p || (p->kind != 1 && p->kind != 2) || !p->uid || p->uid == UINT32_MAX || !p->epoch ||
      !p->clock_epoch || !p->inventory_generation || !mi_e_account(p->account) ||
      (p->mode != 1 && p->mode != 2) || p->valid_until <= p->not_before ||
      p->valid_until - p->not_before > 300001 || p->target_schema != 4 ||
      (p->source_schema != 3 && p->source_schema != 4) || (p->mode == 2 && p->source_schema != 4))
    return 0;
  for (size_t i = 0; i < MI_ENROLLMENT_HASH_COUNT; i++)
    if (i != MI_E_PRIOR_ACCEPTED && !mi_e_nonzero(p->hashes[i], 32))
      return 0;
  for (size_t i = 0; i < 3; i++) {
    const mi_enrollment_fact *f = p->facts + i;
    if (!f->device || !f->inode || !f->links || (f->uid && f->uid != p->uid) ||
        (f->mode & 0170000) != (i ? 0100000 : 0040000) || (i && f->links != 1))
      return 0;
  }
  for (size_t i = 0; i < 4; i++) {
    const mi_enrollment_family *f = p->families + i;
    if (f->id != i + 1 || f->rule != i + 1 || !f->reader || (f->mode != 1 && f->mode != 2))
      return 0;
    for (size_t j = 0; j < MI_ENROLLMENT_FAMILY_HASH_COUNT; j++)
      if (!mi_e_nonzero(f->hashes[j], 32))
        return 0;
  }
  return 1;
}
static MI_E_UNUSED int
mi_enrollment_encode_projection(const mi_enrollment_projection *p,
                                unsigned char out[MI_ENROLLMENT_ACCEPTED_BYTES]) {
  if (!out || !mi_e_projection_valid(p))
    return 0;
  memset(out, 0, MI_ENROLLMENT_ACCEPTED_BYTES);
  memcpy(out, "XMACPT01", 8);
  mi_e_p32(out + 8, 1);
  mi_e_p32(out + 12, MI_ENROLLMENT_ACCEPTED_BYTES);
  mi_e_p32(out + 16, p->kind);
  mi_e_p32(out + 20, p->uid);
  mi_e_p64(out + 24, p->epoch);
  memcpy(out + 160, p->account, 36);
  for (size_t i = 0; i < MI_ENROLLMENT_HASH_COUNT; i++)
    memcpy(out + mi_e_hash_offsets[i], p->hashes[i], 32);
  mi_e_p32(out + 584, p->mode);
  mi_e_p32(out + 588, 4);
  mi_e_p32(out + 592, 1);
  mi_e_p64(out + 632, p->clock_epoch);
  mi_e_p64(out + 640, p->not_before);
  mi_e_p64(out + 648, p->valid_until);
  for (size_t i = 0; i < 3; i++) {
    const mi_enrollment_fact *f = p->facts + i;
    unsigned char *b = out + 688 + 32 * i;
    mi_e_p64(b, f->device);
    mi_e_p64(b + 8, f->inode);
    mi_e_p32(b + 16, f->uid);
    mi_e_p32(b + 20, f->mode);
    mi_e_p64(b + 24, f->links);
  }
  mi_e_p32(out + 784, p->source_schema);
  mi_e_p32(out + 788, p->target_schema);
  mi_e_p64(out + 824, p->inventory_generation);
  for (size_t i = 0; i < 4; i++) {
    const mi_enrollment_family *f = p->families + i;
    unsigned char *b = out + 1024 + 256 * i;
    mi_e_p32(b, f->id);
    mi_e_p32(b + 4, f->rule);
    mi_e_p32(b + 8, f->reader);
    mi_e_p32(b + 12, f->mode);
    for (size_t j = 0; j < MI_ENROLLMENT_FAMILY_HASH_COUNT; j++)
      memcpy(b + 16 + 32 * j, f->hashes[j], 32);
  }
  return mi_e_projection_checksum(out, out + 2048);
}
static MI_E_UNUSED int mi_enrollment_decode_projection(const unsigned char *bytes, size_t size,
                                                       uint32_t expected_kind,
                                                       mi_enrollment_projection *out) {
  if (!bytes || !out || size != MI_ENROLLMENT_ACCEPTED_BYTES ||
      (expected_kind != 1 && expected_kind != 2) || memcmp(bytes, "XMACPT01", 8) ||
      mi_e_u32(bytes + 8) != 1 || mi_e_u32(bytes + 12) != MI_ENROLLMENT_ACCEPTED_BYTES ||
      mi_e_u32(bytes + 16) != expected_kind || mi_e_u32(bytes + 588) != 4 ||
      mi_e_u32(bytes + 592) != 1)
    return 0;
  mi_enrollment_projection p;
  memset(&p, 0, sizeof(p));
  p.kind = expected_kind;
  p.uid = mi_e_u32(bytes + 20);
  p.epoch = mi_e_u64(bytes + 24);
  memcpy(p.account, bytes + 160, 36);
  for (size_t i = 0; i < MI_ENROLLMENT_HASH_COUNT; i++)
    memcpy(p.hashes[i], bytes + mi_e_hash_offsets[i], 32);
  p.mode = mi_e_u32(bytes + 584);
  p.clock_epoch = mi_e_u64(bytes + 632);
  p.not_before = mi_e_u64(bytes + 640);
  p.valid_until = mi_e_u64(bytes + 648);
  p.source_schema = mi_e_u32(bytes + 784);
  p.target_schema = mi_e_u32(bytes + 788);
  p.inventory_generation = mi_e_u64(bytes + 824);
  for (size_t i = 0; i < 3; i++) {
    mi_enrollment_fact *f = p.facts + i;
    const unsigned char *b = bytes + 688 + 32 * i;
    f->device = mi_e_u64(b);
    f->inode = mi_e_u64(b + 8);
    f->uid = mi_e_u32(b + 16);
    f->mode = mi_e_u32(b + 20);
    f->links = mi_e_u64(b + 24);
  }
  for (size_t i = 0; i < 4; i++) {
    mi_enrollment_family *f = p.families + i;
    const unsigned char *b = bytes + 1024 + 256 * i;
    f->id = mi_e_u32(b);
    f->rule = mi_e_u32(b + 4);
    f->reader = mi_e_u32(b + 8);
    f->mode = mi_e_u32(b + 12);
    for (size_t j = 0; j < MI_ENROLLMENT_FAMILY_HASH_COUNT; j++)
      memcpy(f->hashes[j], b + 16 + 32 * j, 32);
  }
  /* One definition checks all fields, reserved bytes and the exact checksum. */
  unsigned char exact[MI_ENROLLMENT_ACCEPTED_BYTES];
  if (!mi_enrollment_encode_projection(&p, exact) || memcmp(exact, bytes, sizeof(exact)))
    return 0;
  *out = p;
  return 1;
}
static MI_E_UNUSED int
mi_enrollment_encode_consume(const mi_enrollment_consume *p,
                             unsigned char out[MI_ENROLLMENT_CONSUME_BYTES]) {
  if (!p || !out || (p->kind != 1 && p->kind != 2) || !p->uid || p->uid == UINT32_MAX || !p->epoch)
    return 0;
  for (size_t i = 0; i < 8; i++)
    if (!mi_e_nonzero(p->hashes[i], 32))
      return 0;
  memset(out, 0, MI_ENROLLMENT_CONSUME_BYTES);
  memcpy(out, "XMCON001", 8);
  mi_e_p32(out + 8, 1);
  mi_e_p32(out + 12, MI_ENROLLMENT_CONSUME_BYTES);
  mi_e_p32(out + 16, p->kind);
  mi_e_p32(out + 20, p->uid);
  mi_e_p64(out + 24, p->epoch);
  for (size_t i = 0; i < 8; i++)
    memcpy(out + 32 + 32 * i, p->hashes[i], 32);
  return mi_e_consume_checksum(out, out + 288);
}
static MI_E_UNUSED int mi_enrollment_decode_consume(const unsigned char *bytes, size_t size,
                                                    uint32_t expected_kind,
                                                    mi_enrollment_consume *out) {
  if (!bytes || !out || size != MI_ENROLLMENT_CONSUME_BYTES ||
      (expected_kind != 1 && expected_kind != 2) || memcmp(bytes, "XMCON001", 8) ||
      mi_e_u32(bytes + 8) != 1 || mi_e_u32(bytes + 12) != MI_ENROLLMENT_CONSUME_BYTES ||
      mi_e_u32(bytes + 16) != expected_kind)
    return 0;
  mi_enrollment_consume p;
  memset(&p, 0, sizeof(p));
  p.kind = expected_kind;
  p.uid = mi_e_u32(bytes + 20);
  p.epoch = mi_e_u64(bytes + 24);
  for (size_t i = 0; i < 8; i++)
    memcpy(p.hashes[i], bytes + 32 + 32 * i, 32);
  unsigned char exact[MI_ENROLLMENT_CONSUME_BYTES];
  if (!mi_enrollment_encode_consume(&p, exact) || memcmp(exact, bytes, sizeof(exact)))
    return 0;
  *out = p;
  return 1;
}
/* Preimage relation only: this never proves that the original SQL committed. */
static MI_E_UNUSED int mi_enrollment_claim_core_hash(const unsigned char *bytes, size_t size,
                                                     uint32_t expected_kind,
                                                     unsigned char out[32]) {
  mi_enrollment_projection p;
  if (!out || !mi_enrollment_decode_projection(bytes, size, expected_kind, &p))
    return 0;
  unsigned char core[2048];
  memcpy(core, bytes, sizeof(core));
  memset(core + 456, 0, 32);
  static const char domain[] = "xiaok-main-root-claim-core-v1";
  return mi_e_hash(domain, sizeof(domain), core, sizeof(core), out);
}
#endif
