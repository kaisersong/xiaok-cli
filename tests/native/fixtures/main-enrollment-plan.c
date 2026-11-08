/* Component-only invocation of the original private consumer APIs. Plan bytes
 * here are a private test file, not production adoption.bin or an approval. */
#include <errno.h>
#include <fcntl.h>
#include <Security/Security.h>
#include <sys/stat.h>
#include <unistd.h>
#define main codec_vector_main
#include "main-enrollment-codec.c"
#undef main
static const char *fault;
static int nonce_count, close_count, fsync_count, write_count;
static OSStatus plan_random(SecRandomRef random, size_t count, void *bytes) {
  nonce_count++;
  if (fault && !strcmp(fault, "random")) return -1;
  return SecRandomCopyBytes(random, count, bytes);
}
static int plan_close(int fd) {
  close_count++;
  int result = close(fd);
  if (fault && (!strcmp(fault, "close") || !strcmp(fault, "close-zero")) && close_count == 1) {
    errno = !strcmp(fault, "close-zero") ? 0 : EIO;
    return -1;
  }
  return result;
}
static int plan_fsync(int fd) {
  fsync_count++;
  int result = fsync(fd);
  if (fault && !strcmp(fault, "fsync") && fsync_count == 1) {
    errno = EIO;
    return -1;
  }
  return result;
}
static ssize_t plan_pwrite(int fd, const void *bytes, size_t count, off_t at) {
  write_count++;
  if (fault && !strcmp(fault, "write")) {
    if (write_count == 1) return pwrite(fd, bytes, 1, at);
    errno = EIO; return -1;
  }
  return pwrite(fd, bytes, count, at);
}
#define SecRandomCopyBytes plan_random
#define close plan_close
#define fsync plan_fsync
#define pwrite plan_pwrite
#include "enrollment-consume-file.h"
#undef pwrite
#undef fsync
#undef close
#undef SecRandomCopyBytes
#ifndef MI_ENROLLMENT_COMPONENT_BUILD
#error COMPONENT_PLAN_DRIVER_CANNOT_GRANT_PRODUCTION_ENROLLMENT
#endif
static int exact_write(int fd, const void *bytes, size_t size) {
  size_t at = 0;
  while (at < size) { ssize_t n = pwrite(fd, (const unsigned char *)bytes + at, size - at, (off_t)at);
    if (n > 0) at += (size_t)n; else if (n < 0 && errno == EINTR) continue; else return 0; }
  return 1;
}
static int write_plan(int root, int fd, const unsigned char bytes[320]) {
  int good = exact_write(fd, bytes, 320) && !fsync(fd);
  if (close(fd)) good = 0;
  if (fsync(root)) good = 0;
  return good;
}
static int read_plan(int root, unsigned char bytes[320]) {
  int fd = openat(root, "component-consume-plan.bin", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return 0;
  struct stat identity; unsigned char extra;
  int good = !fstat(fd, &identity) && S_ISREG(identity.st_mode) && identity.st_nlink == 1 && identity.st_size == 320 && pread(fd, bytes, 320, 0) == 320 && pread(fd, &extra, 1, 320) == 0;
  if (close(fd)) good = 0;
  return good;
}
int main(int argc, char **argv) {
  if (argc != 4) return 64;
  const char *mode = argv[2]; fault = strcmp(argv[3], "none") ? argv[3] : NULL;
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); if (root < 0) return 74;
  mi_enrollment_projection projection; vector(&projection); projection.uid = (uint32_t)geteuid();
  for (int i = 0; i < 3; i++) projection.facts[i].uid = projection.uid;
  unsigned char bytes[MI_ENROLLMENT_ACCEPTED_BYTES], core[32];
  if (!mi_enrollment_encode_projection(&projection, bytes) || !mi_enrollment_claim_core_hash(bytes, sizeof(bytes), 2, core)) return 65;
  memcpy(projection.hashes[MI_E_COMMITTED_COMMAND], core, 32);
  if (!mi_enrollment_encode_projection(&projection, bytes)) return 65;
  if (!strcmp(mode, "seed")) {
    int fd = openat(root, "main-root-family.enrollment", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0 || !exact_write(fd, bytes, sizeof(bytes)) || fsync(fd) || close(fd) || fsync(root)) return 74;
    return close(root) ? 74 : 0;
  }
  mi_enrollment_file_consumer state; mi_enrollment_file_init(&state);
  int good = !strcmp(mode, "unprepared") ? mi_enrollment_plan_create(&state) :
    mi_enrollment_prepare_file(&state, root, bytes, sizeof(bytes));
  if (good && strcmp(mode, "prepare")) {
    if (!strcmp(mode, "create") || !strcmp(mode, "duplicate") || !strcmp(mode, "retry-random")) {
      int plan_fd = openat(root, "component-consume-plan.bin", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
      if (plan_fd < 0) {
        unsigned char original[320];
        good = errno == EEXIST && read_plan(root, original);
        if (good) good = mi_enrollment_plan_restore(&state, original, sizeof(original));
      } else {
        good = mi_enrollment_plan_create(&state);
        if (good) good = write_plan(root, plan_fd, state.record);
        else if (close(plan_fd)) return 74;
      }
      if (good && !strcmp(mode, "duplicate")) good = mi_enrollment_plan_create(&state);
      if (!strcmp(mode, "retry-random")) good = mi_enrollment_plan_create(&state);
    } else {
      unsigned char plan[320]; good = read_plan(root, plan);
      if (good && (!strcmp(mode, "foreign-pool") || !strcmp(mode, "different-nonce"))) {
        mi_enrollment_consume original;
        good = mi_enrollment_decode_consume(plan, sizeof(plan), 2, &original);
        if (good) { original.hashes[!strcmp(mode, "foreign-pool") ? 4 : 5][0] ^= 1;
          good = mi_enrollment_encode_consume(&original, plan); }
      }
      if (good && !strcmp(mode, "bad-checksum")) plan[20] ^= 1;
      if (good) good = mi_enrollment_plan_restore(&state, plan, sizeof(plan));
      if (good && !strcmp(mode, "change-accepted")) {
        int fd = openat(root, "main-root-family.enrollment", O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
        unsigned char changed = bytes[264] ^ 1;
        if (fd < 0 || pwrite(fd, &changed, 1, 264) != 1 || fsync(fd) || close(fd)) return 74;
      }
      if (good) good = mi_enrollment_consume_prepared(&state);
    }
  }
  int close_known = mi_enrollment_file_close(&state);
  printf("{\"scope\":\"component-private-plan-only\",\"good\":%s,\"prepared\":%s,\"planned\":%s,\"status\":%d,\"unknown\":%s,\"errorPresent\":%s,\"firstErrno\":%d,\"reason\":\"%s\",\"name\":\"%s\",\"nonceCalls\":%d,\"closes\":%d,\"fsyncs\":%d,\"writes\":%d,\"closeKnown\":%s,\"failedFileFd\":%d,\"failedAcceptedFd\":%d}\n",
    good ? "true" : "false", state.prepared ? "true" : "false", state.planned ? "true" : "false", state.status,
    state.unknown ? "true" : "false", state.error_present ? "true" : "false", state.first_errno,
    state.reason ? state.reason : "", state.name, nonce_count, close_count, fsync_count, write_count,
    close_known ? "true" : "false", state.file.close_unknown ? state.file.fd : -1, state.accepted.close_unknown ? state.accepted.fd : -1);
  if (!state.unknown && close(root)) return 74;
  return 0;
}
