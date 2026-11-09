#include "enrollment-codec.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void vector(mi_enrollment_projection *p) {
  memset(p, 0, sizeof(*p));
  p->kind = 2;
  p->uid = 0x01020304;
  p->epoch = UINT64_C(4294967298);
  memcpy(p->account, "11111111-AAAA-BBBB-CCCC-555555555555", 36);
  p->mode = 1;
  p->clock_epoch = 1;
  p->not_before = 1000;
  p->valid_until = 2000;
  p->source_schema = 3;
  p->target_schema = 4;
  p->inventory_generation = 7;
  for (size_t i = 0; i < MI_ENROLLMENT_HASH_COUNT; i++)
    memset(p->hashes[i], (int)i + 1, 32);
  memset(p->hashes[MI_E_PRIOR_ACCEPTED], 0, 32);
  for (size_t i = 0; i < 3; i++) {
    p->facts[i].device = i ? 1 : UINT64_C(4294967298);
    p->facts[i].inode = 3 + i;
    p->facts[i].uid = p->uid;
    p->facts[i].mode = i ? 0100600 : 0040700;
    p->facts[i].links = i ? 1 : 2;
  }
  for (size_t i = 0; i < 4; i++) {
    p->families[i].id = (uint32_t)i + 1;
    p->families[i].rule = (uint32_t)i + 1;
    p->families[i].reader = 1;
    p->families[i].mode = 1;
    memset(p->families[i].hashes, 0x12, sizeof(p->families[i].hashes));
  }
}
int main(int argc, char **argv) {
  unsigned char bytes[MI_ENROLLMENT_ACCEPTED_BYTES];
  mi_enrollment_projection p;
  if (argc != 2)
    return 64;
  if (!strcmp(argv[1], "encode-consume-vector")) {
    mi_enrollment_consume q;
    memset(&q, 0, sizeof(q));
    q.kind = 2;
    q.uid = 501;
    q.epoch = 7;
    const unsigned char patterns[] = {0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xef};
    for (size_t i = 0; i < 8; i++)
      memset(q.hashes[i], patterns[i], 32);
    unsigned char out[MI_ENROLLMENT_CONSUME_BYTES];
    if (!mi_enrollment_encode_consume(&q, out))
      return 65;
    return fwrite(out, 1, sizeof(out), stdout) == sizeof(out) ? 0 : 74;
  }
  if (!strcmp(argv[1], "decode-consume-component") ||
      !strcmp(argv[1], "decode-consume-production")) {
    unsigned char in[MI_ENROLLMENT_CONSUME_BYTES], out[MI_ENROLLMENT_CONSUME_BYTES];
    mi_enrollment_consume q;
    if (fread(in, 1, sizeof(in), stdin) != sizeof(in) || fgetc(stdin) != EOF)
      return 65;
    if (!mi_enrollment_decode_consume(in, sizeof(in),
                                      !strcmp(argv[1], "decode-consume-production") ? 1 : 2, &q) ||
        !mi_enrollment_encode_consume(&q, out) || memcmp(in, out, sizeof(in)))
      return 65;
    return 0;
  }
  if (!strcmp(argv[1], "core-hash-component")) {
    unsigned char out[32];
    if (fread(bytes, 1, sizeof(bytes), stdin) != sizeof(bytes) || fgetc(stdin) != EOF ||
        !mi_enrollment_claim_core_hash(bytes, sizeof(bytes), 2, out))
      return 65;
    return fwrite(out, 1, sizeof(out), stdout) == sizeof(out) ? 0 : 74;
  }
  if (!strcmp(argv[1], "encode-vector")) {
    vector(&p);
    if (!mi_enrollment_encode_projection(&p, bytes))
      return 65;
    return fwrite(bytes, 1, sizeof(bytes), stdout) == sizeof(bytes) ? 0 : 74;
  }
  if (!strcmp(argv[1], "decode-component") || !strcmp(argv[1], "decode-production")) {
    if (fread(bytes, 1, sizeof(bytes), stdin) != sizeof(bytes) || fgetc(stdin) != EOF)
      return 65;
    int expected = !strcmp(argv[1], "decode-production") ? 1 : 2;
    if (!mi_enrollment_decode_projection(bytes, sizeof(bytes), expected, &p))
      return 65;
    unsigned char same[MI_ENROLLMENT_ACCEPTED_BYTES];
    if (!mi_enrollment_encode_projection(&p, same) || memcmp(bytes, same, sizeof(bytes)))
      return 66;
    return 0;
  }
  return 64;
}
