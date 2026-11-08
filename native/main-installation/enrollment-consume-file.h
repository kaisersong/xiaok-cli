#ifndef XIAOK_MAIN_ROOT_ENROLLMENT_CONSUME_FILE_H
#define XIAOK_MAIN_ROOT_ENROLLMENT_CONSUME_FILE_H
#include "enrollment-codec.h"
/* Only the original helper's metadata primitive. A success here proves one
 * durable consumption file, NOT Source eligibility or namespace permission.
 * The helper must finish its fixed certificate/publisher/Source/clock/migration
 * checks BEFORE calling this function and keep the same original owner. */
#ifdef __APPLE__
#include <Security/SecRandom.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef MI_ENROLLMENT_COMPONENT_BUILD
#define MI_ENROLLMENT_CONSUMER_KIND 2u
#else
#define MI_ENROLLMENT_CONSUMER_KIND 1u
#endif
enum {
  MI_E_FILE_NONE = 0,
  MI_E_FILE_CREATED = 1,
  MI_E_FILE_EXISTING = 2,
  MI_E_FILE_DENIED = 3,
  MI_E_FILE_UNKNOWN = 4
};
typedef struct mi_enrollment_file_fd {
  int fd, close_entered, close_unknown;
  struct stat identity;
} mi_enrollment_file_fd;
typedef struct mi_enrollment_file_consumer {
  /* metadata_root is borrowed from the original helper, never owned here. */
  int metadata_root, called, status, unknown, error_present, first_errno, entered;
  int prepared, plan_attempted, planned, commit_attempted;
  const char *reason;
  mi_enrollment_file_fd file, accepted;
  mi_enrollment_projection projection;
  mi_enrollment_consume consume;
  unsigned char accepted_digest[32], physical_binding[32], record[MI_ENROLLMENT_CONSUME_BYTES];
  unsigned char planned_record[MI_ENROLLMENT_CONSUME_BYTES];
  char name[96];
} mi_enrollment_file_consumer;
static MI_E_UNUSED void mi_enrollment_file_init(mi_enrollment_file_consumer *s) {
  memset(s, 0, sizeof(*s));
  s->metadata_root = s->file.fd = s->accepted.fd = -1;
}
static MI_E_UNUSED int mi_e_file_fail(mi_enrollment_file_consumer *s, const char *reason, int error,
                                      int uncertain) {
  if (!s->error_present) {
    s->error_present = 1;
    s->first_errno = error;
    s->reason = reason;
  }
  if (uncertain)
    s->unknown = 1;
  s->status = s->unknown ? MI_E_FILE_UNKNOWN : MI_E_FILE_DENIED;
  return 0;
}
static MI_E_UNUSED int mi_e_close_one(mi_enrollment_file_consumer *s, mi_enrollment_file_fd *f) {
  if (f->fd < 0)
    return !s->unknown;
  if (f->close_entered)
    return !f->close_unknown;
  f->close_entered = 1;
  errno = 0;
  if (close(f->fd)) {
    f->close_unknown = 1;
    return mi_e_file_fail(s, "MI_CONSUME_CLOSE_UNKNOWN", errno, 1);
  }
  f->fd = -1;
  return 1;
}
static MI_E_UNUSED int mi_e_file_close(mi_enrollment_file_consumer *s) {
  return mi_e_close_one(s, &s->file);
}
static MI_E_UNUSED int mi_enrollment_file_close(mi_enrollment_file_consumer *s) {
  int good = 1;
  if (!mi_e_close_one(s, &s->file))
    good = 0;
  if (!mi_e_close_one(s, &s->accepted))
    good = 0;
  return good && !s->unknown;
}
static MI_E_UNUSED int mi_e_file_identity(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_uid == b->st_uid &&
         a->st_mode == b->st_mode && a->st_nlink == b->st_nlink;
}
static MI_E_UNUSED int mi_e_file_regular(const struct stat *v) {
#ifdef MI_ENROLLMENT_COMPONENT_BUILD
  uid_t owner = geteuid();
#else
  uid_t owner = 0;
#endif
  return S_ISREG(v->st_mode) && v->st_uid == owner && v->st_nlink == 1 &&
         (v->st_mode & 07777) == 0600;
}
static MI_E_UNUSED int mi_e_file_current(mi_enrollment_file_consumer *s) {
  struct stat held, named;
  errno = 0;
  if (fstat(s->file.fd, &held) || fstatat(s->metadata_root, s->name, &named, AT_SYMLINK_NOFOLLOW))
    return mi_e_file_fail(s, "MI_CONSUME_IDENTITY_UNKNOWN", errno, 1);
  if (!mi_e_file_regular(&held) || !mi_e_file_identity(&held, &s->file.identity) ||
      !mi_e_file_identity(&held, &named))
    return mi_e_file_fail(s, "MI_CONSUME_IDENTITY_CHANGED", EINVAL, 1);
  return 1;
}
static MI_E_UNUSED int mi_e_file_read(mi_enrollment_file_consumer *s) {
  size_t at = 0;
  while (at < sizeof(s->record)) {
    errno = 0;
    ssize_t n = pread(s->file.fd, s->record + at, sizeof(s->record) - at, (off_t)at);
    if (n > 0)
      at += (size_t)n;
    else if (n < 0 && errno == EINTR)
      continue;
    else
      return mi_e_file_fail(s, "MI_CONSUME_PARTIAL_PRESENT", n < 0 ? errno : EINVAL, 1);
  }
  unsigned char extra;
  errno = 0;
  ssize_t n = pread(s->file.fd, &extra, 1, (off_t)sizeof(s->record));
  if (n != 0)
    return mi_e_file_fail(s, "MI_CONSUME_FOREIGN_PRESENT", n < 0 ? errno : EINVAL, 1);
  if (!mi_enrollment_decode_consume(s->record, sizeof(s->record), MI_ENROLLMENT_CONSUMER_KIND,
                                    &s->consume))
    return mi_e_file_fail(s, "MI_CONSUME_FOREIGN_PRESENT", EINVAL, 1);
  return 1;
}
static MI_E_UNUSED int mi_e_file_bindings(mi_enrollment_file_consumer *s) {
  const mi_enrollment_projection *p = &s->projection;
  const mi_enrollment_consume *c = &s->consume;
  if (c->kind != p->kind || c->uid != p->uid || c->epoch != p->epoch ||
      memcmp(c->hashes[0], p->hashes[MI_E_OPERATION], 32) ||
      memcmp(c->hashes[1], s->accepted_digest, 32) ||
      memcmp(c->hashes[2], p->hashes[MI_E_NAMESPACE], 32) ||
      memcmp(c->hashes[3], p->hashes[MI_E_BIRTH], 32) ||
      memcmp(c->hashes[4], p->hashes[MI_E_POOL], 32) ||
      memcmp(c->hashes[6], p->hashes[MI_E_PUBLISHER_RELEASE], 32) ||
      memcmp(c->hashes[7], s->physical_binding, 32))
    return mi_e_file_fail(s, "MI_CONSUME_FOREIGN_PRESENT", EINVAL, 1);
  return 1;
}
static MI_E_UNUSED int mi_e_file_open_existing(mi_enrollment_file_consumer *s) {
  errno = 0;
  s->file.fd = openat(s->metadata_root, s->name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (s->file.fd < 0)
    return mi_e_file_fail(s, "MI_CONSUME_OPEN_UNKNOWN", errno, 1);
  errno = 0;
  if (fstat(s->file.fd, &s->file.identity))
    return mi_e_file_fail(s, "MI_CONSUME_STAT_UNKNOWN", errno, 1);
  if (!mi_e_file_regular(&s->file.identity))
    return mi_e_file_fail(s, "MI_CONSUME_FOREIGN_PRESENT", EINVAL, 1);
  if (!mi_e_file_read(s) || !mi_e_file_bindings(s) || !mi_e_file_current(s))
    return 0;
  /* A complete cold read is observation, not confirmation that an earlier
   * unknown write/file-sync/directory-sync became durable. Re-confirm this same
   * original record; never manufacture a new nonce or replacement file. */
  errno = 0;
  if (fsync(s->file.fd))
    return mi_e_file_fail(s, "MI_CONSUME_FSYNC_UNKNOWN", errno, 1);
  if (!mi_e_file_current(s))
    return 0;
  s->status = MI_E_FILE_EXISTING;
  return 1;
}
static MI_E_UNUSED int mi_e_prepare_projection(mi_enrollment_file_consumer *s, int borrowed_root,
                                                const unsigned char *projection, size_t bytes) {
  if (borrowed_root < 0 || !mi_enrollment_decode_projection(
                               projection, bytes, MI_ENROLLMENT_CONSUMER_KIND, &s->projection))
    return mi_e_file_fail(s, "MI_CONSUME_PROJECTION_INVALID", EINVAL, 0);
  /* The commit core is a binding, never independent commit/Source evidence. */
  unsigned char core[32];
  if (!mi_enrollment_claim_core_hash(projection, bytes, MI_ENROLLMENT_CONSUMER_KIND, core) ||
      memcmp(core, s->projection.hashes[MI_E_COMMITTED_COMMAND], 32))
    return mi_e_file_fail(s, "MI_CONSUME_CORE_BINDING_INVALID", EINVAL, 0);
  static const char accepted_domain[] = "xiaok-main-root-accepted-file-v1";
  if (!mi_e_hash(accepted_domain, sizeof(accepted_domain), projection, bytes, s->accepted_digest))
    return mi_e_file_fail(s, "MI_CONSUME_HASH_UNKNOWN", EIO, 0);
  static const char prefix[] = "enrollment-consume-";
  memcpy(s->name, prefix, sizeof(prefix) - 1);
  static const char hex[] = "0123456789abcdef";
  size_t base = sizeof(prefix) - 1;
  for (size_t i = 0; i < 32; i++) {
    unsigned b = s->projection.hashes[MI_E_OPERATION][i];
    s->name[base + 2 * i] = hex[b >> 4];
    s->name[base + 2 * i + 1] = hex[b & 15];
  }
  memcpy(s->name + base + 64, ".bin", 5);
  return 1;
}
static MI_E_UNUSED void mi_e_consume_bindings(mi_enrollment_file_consumer *s) {
  mi_enrollment_consume *c = &s->consume;
  memset(c, 0, sizeof(*c));
  c->kind = s->projection.kind;
  c->uid = s->projection.uid;
  c->epoch = s->projection.epoch;
  memcpy(c->hashes[0], s->projection.hashes[MI_E_OPERATION], 32);
  memcpy(c->hashes[1], s->accepted_digest, 32);
  memcpy(c->hashes[2], s->projection.hashes[MI_E_NAMESPACE], 32);
  memcpy(c->hashes[3], s->projection.hashes[MI_E_BIRTH], 32);
  memcpy(c->hashes[4], s->projection.hashes[MI_E_POOL], 32);
  memcpy(c->hashes[6], s->projection.hashes[MI_E_PUBLISHER_RELEASE], 32);
  /* This binding came from this same actual fixed accepted FD and bytes. */
  memcpy(c->hashes[7], s->physical_binding, 32);
}
static MI_E_UNUSED int mi_e_write_loaded(mi_enrollment_file_consumer *s, int borrowed_root) {
  s->entered = 1;
  errno = 0;
  s->file.fd =
      openat(borrowed_root, s->name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (s->file.fd < 0)
    return mi_e_file_fail(
        s, errno == EEXIST ? "MI_CONSUME_CONCURRENT_PRESENT" : "MI_CONSUME_OPEN_UNKNOWN", errno, 1);
  int good = 1;
  errno = 0;
  if (fstat(s->file.fd, &s->file.identity) || !mi_e_file_regular(&s->file.identity))
    good = mi_e_file_fail(s, "MI_CONSUME_STAT_UNKNOWN", errno, 1);
  for (size_t at = 0; good && at < sizeof(s->record);) {
    errno = 0;
    ssize_t n = pwrite(s->file.fd, s->record + at, sizeof(s->record) - at, (off_t)at);
    if (n > 0)
      at += (size_t)n;
    else if (n < 0 && errno == EINTR)
      continue;
    else
      good = mi_e_file_fail(s, "MI_CONSUME_WRITE_UNKNOWN", errno, 1);
  }
  if (good) {
    errno = 0;
    if (fsync(s->file.fd))
      good = mi_e_file_fail(s, "MI_CONSUME_FSYNC_UNKNOWN", errno, 1);
  }
  if (good)
    good = mi_e_file_current(s);
  if (good && !s->unknown)
    s->status = MI_E_FILE_CREATED;
  return good && !s->unknown;
}
static MI_E_UNUSED int mi_e_consume_loaded(mi_enrollment_file_consumer *s, int borrowed_root,
                                           const unsigned char *projection, size_t bytes) {
  if (!mi_e_prepare_projection(s, borrowed_root, projection, bytes))
    return 0;
  struct stat prior;
  errno = 0;
  int observed = fstatat(borrowed_root, s->name, &prior, AT_SYMLINK_NOFOLLOW);
  if (!observed)
    return mi_e_file_open_existing(s);
  if (errno != ENOENT)
    return mi_e_file_fail(s, "MI_CONSUME_PROBE_UNKNOWN", errno, 1);
#ifndef MI_ENROLLMENT_COMPONENT_BUILD
  /* A restore cannot create new consumption, and a real same-inode v7->v8
   * migration must be connected before production can burn its one-use claim. */
  return mi_e_file_fail(
      s, s->projection.mode == 1 ? "MI_MIGRATION_NOT_IMPLEMENTED" : "MI_CONSUME_RESTORE_MISSING",
      EPERM, 0);
#else
  if (s->projection.mode != 1)
    return mi_e_file_fail(s, "MI_CONSUME_RESTORE_MISSING", EPERM, 0);
#endif
  mi_e_consume_bindings(s);
  mi_enrollment_consume *c = &s->consume;
  if (SecRandomCopyBytes(kSecRandomDefault, 32, c->hashes[5]) != errSecSuccess ||
      !mi_e_nonzero(c->hashes[5], 32))
    return mi_e_file_fail(s, "MI_CONSUME_NONCE_UNKNOWN", EIO, 0);
  if (!mi_enrollment_encode_consume(c, s->record))
    return mi_e_file_fail(s, "MI_CONSUME_ENCODING_INVALID", EINVAL, 0);
  return mi_e_write_loaded(s, borrowed_root);
}
static MI_E_UNUSED int mi_e_accepted_current(mi_enrollment_file_consumer *s) {
  struct stat held, named;
  errno = 0;
  if (fstat(s->accepted.fd, &held) ||
      fstatat(s->metadata_root, "main-root-family.enrollment", &named, AT_SYMLINK_NOFOLLOW))
    return mi_e_file_fail(s, "MI_ACCEPTED_IDENTITY_UNKNOWN", errno, 1);
  if (!mi_e_file_regular(&held) || held.st_size != MI_ENROLLMENT_ACCEPTED_BYTES ||
      !mi_e_file_identity(&held, &s->accepted.identity) || !mi_e_file_identity(&held, &named))
    return mi_e_file_fail(s, "MI_ACCEPTED_IDENTITY_CHANGED", EINVAL, 1);
  return 1;
}
static MI_E_UNUSED int mi_e_accepted_bytes(mi_enrollment_file_consumer *s,
                                         const unsigned char *expected, size_t bytes) {
  unsigned char actual[MI_ENROLLMENT_ACCEPTED_BYTES];
  size_t at = 0;
  while (at < sizeof(actual)) {
    errno = 0;
    ssize_t n = pread(s->accepted.fd, actual + at, sizeof(actual) - at, (off_t)at);
    if (n > 0)
      at += (size_t)n;
    else if (n < 0 && errno == EINTR)
      continue;
    else
      return mi_e_file_fail(s, "MI_ACCEPTED_READ_UNKNOWN", n < 0 ? errno : EINVAL, 1);
  }
  if (bytes != sizeof(actual) || memcmp(actual, expected, sizeof(actual)))
    return mi_e_file_fail(s, "MI_ACCEPTED_SOURCE_CHANGED", EINVAL, 1);
  if (!mi_e_accepted_current(s))
    return 0;
  return 1;
}
static MI_E_UNUSED int mi_e_read_accepted(mi_enrollment_file_consumer *s,
                                          const unsigned char *expected, size_t bytes) {
  errno = 0;
  s->accepted.fd =
      openat(s->metadata_root, "main-root-family.enrollment", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (s->accepted.fd < 0)
    return mi_e_file_fail(s, "MI_ACCEPTED_SOURCE_UNAVAILABLE", errno, 0);
  errno = 0;
  if (fstat(s->accepted.fd, &s->accepted.identity))
    return mi_e_file_fail(s, "MI_ACCEPTED_STAT_UNKNOWN", errno, 1);
  if (!mi_e_file_regular(&s->accepted.identity) ||
      s->accepted.identity.st_size != MI_ENROLLMENT_ACCEPTED_BYTES)
    return mi_e_file_fail(s, "MI_ACCEPTED_SOURCE_INVALID", EINVAL, 1);
  if (!mi_e_accepted_bytes(s, expected, bytes))
    return 0;
  unsigned char facts[64];
  const struct stat *v = &s->accepted.identity;
  mi_e_p64(facts, (uint64_t)v->st_dev);
  mi_e_p64(facts + 8, (uint64_t)v->st_ino);
  mi_e_p32(facts + 16, (uint32_t)v->st_uid);
  mi_e_p32(facts + 20, (uint32_t)v->st_mode);
  mi_e_p64(facts + 24, (uint64_t)v->st_nlink);
  memcpy(facts + 32, s->accepted_digest, 32);
  static const char domain[] = "xiaok-main-root-accepted-file-identity-v1";
  return mi_e_hash(domain, sizeof(domain), facts, sizeof(facts), s->physical_binding) ||
         mi_e_file_fail(s, "MI_ACCEPTED_IDENTITY_HASH_UNKNOWN", EIO, 0);
}
static MI_E_UNUSED int mi_enrollment_consume_file(mi_enrollment_file_consumer *s, int borrowed_root,
                                                  const unsigned char *projection, size_t bytes) {
  if (!s || s->called)
    return 0;
  s->called = 1;
  s->metadata_root = borrowed_root;
  if (borrowed_root < 0 || !mi_enrollment_decode_projection(
                               projection, bytes, MI_ENROLLMENT_CONSUMER_KIND, &s->projection))
    return mi_e_file_fail(s, "MI_CONSUME_PROJECTION_INVALID", EINVAL, 0);
  static const char domain[] = "xiaok-main-root-accepted-file-v1";
  int good = mi_e_hash(domain, sizeof(domain), projection, bytes, s->accepted_digest);
  if (!good)
    mi_e_file_fail(s, "MI_ACCEPTED_HASH_UNKNOWN", EIO, 0);
  if (good)
    good = mi_e_read_accepted(s, projection, bytes);
  if (good)
    good = mi_e_consume_loaded(s, borrowed_root, projection, bytes);
  if (good)
    good = mi_e_accepted_current(s);
  if (!mi_enrollment_file_close(s))
    good = 0;
  if (good && (s->status == MI_E_FILE_CREATED || s->status == MI_E_FILE_EXISTING)) {
    errno = 0;
    if (fsync(borrowed_root))
      good = mi_e_file_fail(s, "MI_CONSUME_DIRECTORY_UNKNOWN", errno, 1);
  }
  return good && !s->unknown;
}
#include "enrollment-consume-plan.h"
#endif /* Darwin only: no filesystem stubs or platform permission fallback. */
#endif
