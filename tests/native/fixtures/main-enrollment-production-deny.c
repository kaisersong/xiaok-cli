/* Test-only negative primitive probe. No component grant, real root install,
 * protected accepted file, Source or namespace permission is supplied here. */
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <unistd.h>
#define main codec_vector_main
#include "main-enrollment-codec.c"
#undef main
#ifdef MI_ENROLLMENT_COMPONENT_BUILD
#error PRODUCTION_DENIAL_PROBE_MUST_NOT_ENABLE_COMPONENT_CREATION
#endif
static int openat_calls, create_calls;
static int observed_openat(int directory, const char *name, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
    create_calls++;
  }
  openat_calls++;
  return openat(directory, name, flags, mode);
}
#define openat observed_openat
#include "enrollment-consume-file.h"
#undef openat
int main(int argc, char **argv) {
  if (argc != 3)
    return 64;
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0)
    return 74;
  mi_enrollment_projection p;
  vector(&p);
  p.kind = 1;
  p.mode = !strcmp(argv[2], "migration") ? 1 : 2;
  if (p.mode == 2)
    p.source_schema = 4;
  unsigned char bytes[MI_ENROLLMENT_ACCEPTED_BYTES], core[32];
  if (!mi_enrollment_encode_projection(&p, bytes) ||
      !mi_enrollment_claim_core_hash(bytes, sizeof(bytes), 1, core))
    return 65;
  memcpy(p.hashes[MI_E_COMMITTED_COMMAND], core, 32);
  if (!mi_enrollment_encode_projection(&p, bytes))
    return 65;
  mi_enrollment_file_consumer s;
  mi_enrollment_file_init(&s);
  s.metadata_root = root;
  memset(s.physical_binding, 0x7a, 32);
  /* Direct original private FSM rejection, not an assertion that its upstream
   * certificate/accepted-FD/Source preconditions have actually succeeded. */
  int good = mi_e_consume_loaded(&s, root, bytes, sizeof(bytes));
  int closed = mi_enrollment_file_close(&s);
  printf("{\"scope\":\"production-metadata-negative-only\",\"good\":%s,"
         "\"status\":%d,\"unknown\":%s,\"reason\":\"%s\",\"openatCalls\":%d,"
         "\"createCalls\":%d,\"closeKnown\":%s}\n",
         good ? "true" : "false", s.status, s.unknown ? "true" : "false", s.reason ? s.reason : "",
         openat_calls, create_calls, closed ? "true" : "false");
  return close(root) ? 74 : 0;
}
