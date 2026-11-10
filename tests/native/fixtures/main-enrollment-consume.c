#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#define main codec_vector_main
#include "main-enrollment-codec.c"
#undef main
static const char *fault;
static int close_count, fsync_count;
static int consume_close(int fd) {
  close_count++;
  int rc = close(fd);
  if (fault && (!strcmp(fault, "close") || !strcmp(fault, "close-zero")) && close_count == 1) {
    errno = !strcmp(fault, "close-zero") ? 0 : EIO;
    return -1;
  }
  return rc;
}
static int consume_fsync(int fd) {
  fsync_count++;
  int rc = fsync(fd);
  if (fault && !strcmp(fault, "fsync") && fsync_count == 1) {
    errno = EIO;
    return -1;
  }
  return rc;
}
#define close consume_close
#define fsync consume_fsync
#include "enrollment-consume-file.h"
#undef close
#undef fsync
#ifndef MI_ENROLLMENT_COMPONENT_BUILD
#error THIS_TEST_DRIVER_IS_NOT_PRODUCTION_AUTHORITY
#endif
int main(int argc, char **argv) {
  if (argc != 4)
    return 64;
  fault = strcmp(argv[3], "none") ? argv[3] : NULL;
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0)
    return 74;
  mi_enrollment_projection p;
  vector(&p);
  p.uid = (uint32_t)geteuid();
  for (size_t i = 0; i < 3; i++)
    p.facts[i].uid = p.uid;
  unsigned char bytes[MI_ENROLLMENT_ACCEPTED_BYTES], core[32];
  if (!mi_enrollment_encode_projection(&p, bytes) ||
      !mi_enrollment_claim_core_hash(bytes, sizeof(bytes), 2, core))
    return 65;
  memcpy(p.hashes[MI_E_COMMITTED_COMMAND], core, 32);
  if (!mi_enrollment_encode_projection(&p, bytes))
    return 65;
  if (!strcmp(argv[2], "create") || !strcmp(argv[2], "write-accepted")) {
    int f = openat(root, "main-root-family.enrollment",
                   O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (f < 0)
      return 74;
    if (write(f, bytes, sizeof(bytes)) != (ssize_t)sizeof(bytes) || fsync(f) || close(f) ||
        fsync(root))
      return 74;
  }
  if (!strcmp(argv[2], "write-accepted")) {
    close(root);
    return 0;
  }
  mi_enrollment_file_consumer s;
  mi_enrollment_file_init(&s);
  int good = mi_enrollment_consume_file(&s, root, bytes, sizeof(bytes));
  int close_good = mi_enrollment_file_close(&s);
  printf("{\"scope\":\"metadata-component-only\",\"good\":%s,\"closeKnown\":%s,\"status\":%d,"
         "\"unknown\":%s,\"errorPresent\":%s,\"firstErrno\":%d,\"reason\":\"%s\",\"name\":\"%s\","
         "\"closes\":%d,\"fsyncs\":%d,\"rootRetained\":%s}\n",
         good ? "true" : "false", close_good ? "true" : "false", s.status,
         s.unknown ? "true" : "false", s.error_present ? "true" : "false", s.first_errno,
         s.reason ? s.reason : "", s.name, close_count, fsync_count, s.unknown ? "true" : "false");
  if (!s.unknown)
    close(root);
  return 0;
}
