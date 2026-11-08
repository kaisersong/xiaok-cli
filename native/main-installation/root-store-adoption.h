#ifndef XIAOK_ORIGINAL_ROOT_STORE_ADOPTION_H
#define XIAOK_ORIGINAL_ROOT_STORE_ADOPTION_H
/* Included after the original helper's state and root-store primitives.
 * The fixed Native Entry owns registration/current/unknown. No JS provider,
 * caller pathname, verifier callback, or permission flag enters this module. */
#include "../root-resource-authority/root-pool-adoption-record.h"
#include "enrollment-consume-file.h"
typedef struct mi_original_adoption {
  int source_directory_fd, source_database_fd, source_issuer_lock_fd, phase, unknown;
  uid_t source_uid;
  struct stat source_directory, source_database, source_issuer_lock;
  unsigned char old_pool_id[32], root_ledger_digest[32], operation_id[32];
  unsigned char namespace_id[32], birth_id[32], claim_id[32], accepted_digest[32];
  unsigned char accepted_projection[MI_ENROLLMENT_ACCEPTED_BYTES];
  mi_enrollment_file_consumer consumer;
} mi_original_adoption;
static int mi_original_adoption_current(state *, const mi_original_adoption *);
static void mi_original_adoption_unknown(state *, const mi_original_adoption *, int);
static mi_original_adoption *mi_original_adoption_for_state(state *);
static int mi_original_adoption_close_owned(state *, const mi_original_adoption *);
static int store_adoption_fail(state *s, mi_store_lease *l, const mi_original_adoption *a,
                               int error) {
  store_mark_unknown(s, l);
  mi_original_adoption_unknown(s, a, error);
  errno = error;
  return 0;
}
static int store_adoption_file_fact(const struct stat *v, nr_root_file_fact *out) {
  if ((uint64_t)v->st_dev > INT64_MAX || (uint64_t)v->st_ino > INT64_MAX)
    return 0;
  out->device = (uint64_t)v->st_dev;
  out->inode = (uint64_t)v->st_ino;
  out->uid = v->st_uid;
  out->mode = v->st_mode;
  out->nlink = v->st_nlink;
  return 1;
}
static int store_adoption_history(const mi_original_adoption *a, nr_original_pool_history *out) {
  memset(out, 0, sizeof(*out));
  out->main_principal_uid = a->source_uid;
  memcpy(out->pool_id, a->old_pool_id, 32);
  return store_adoption_file_fact(&a->source_directory, &out->directory) &&
         store_adoption_file_fact(&a->source_database, &out->database) &&
         store_adoption_file_fact(&a->source_issuer_lock, &out->issuer_lock) &&
         nr_original_pool_history_valid(out);
}
static int store_adoption_current_files(const mi_original_adoption *a) {
  struct stat directory, database, issuer;
  return !fstat(a->source_directory_fd, &directory) && identity(&directory, &a->source_directory) &&
         !fstat(a->source_database_fd, &database) && identity(&database, &a->source_database) &&
         !fstat(a->source_issuer_lock_fd, &issuer) && identity(&issuer, &a->source_issuer_lock);
}
static int store_adoption_absent_source_sidecars(const mi_original_adoption *a) {
  const char *names[] = {"root-resource-v1.sqlite-journal", "root-resource-v1.sqlite-wal",
                         "root-resource-v1.sqlite-shm"};
  struct stat fact;
  for (size_t i = 0; i < sizeof(names) / sizeof(*names); i++) {
    if (!fstatat(a->source_directory_fd, names[i], &fact, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
      return 0;
  }
  return 1;
}
static int store_adoption_record_read(state *s, mi_store_lease *l, nr_pool_adoption_record *out,
                                      unsigned char wire[NR_POOL_ADOPTION_RECORD_BYTES]) {
  l->validation_fd =
      openat(l->authority, NR_POOL_ADOPTION_RECORD_NAME, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  struct stat fact;
  int good = l->validation_fd >= 0 && regular_owned(l->validation_fd, getuid(), &fact) &&
             fact.st_size == NR_POOL_ADOPTION_RECORD_BYTES &&
             st_exact_read(l->validation_fd, wire, NR_POOL_ADOPTION_RECORD_BYTES, 0) &&
             nr_pool_adoption_record_decode(wire, NR_POOL_ADOPTION_RECORD_BYTES,
                                            MI_ENROLLMENT_CONSUMER_KIND, out);
  if (l->validation_fd >= 0 && !store_close_fd(s, l, &l->validation_fd))
    good = 0;
  return good;
}
static int store_adoption_existing_plan(state *s, mi_store_lease *l, mi_original_adoption *a,
                                        nr_pool_adoption_record *record) {
  unsigned char wire[NR_POOL_ADOPTION_RECORD_BYTES];
  if (!store_adoption_record_read(s, l, record, wire) ||
      memcmp(record->accepted_digest, a->accepted_digest, 32) ||
      memcmp(record->fuse.operation_id, a->operation_id, 32) ||
      memcmp(record->fuse.namespace_id, a->namespace_id, 32) ||
      memcmp(record->fuse.birth_id, a->birth_id, 32) ||
      memcmp(record->history.pool_id, a->old_pool_id, 32) ||
      record->history.main_principal_uid != a->source_uid ||
      record->history.database.device != (uint64_t)a->source_database.st_dev ||
      record->history.database.inode != (uint64_t)a->source_database.st_ino ||
      record->history.issuer_lock.device != (uint64_t)a->source_issuer_lock.st_dev ||
      record->history.issuer_lock.inode != (uint64_t)a->source_issuer_lock.st_ino ||
      record->history.directory.device != (uint64_t)a->source_directory.st_dev ||
      record->history.directory.inode != (uint64_t)a->source_directory.st_ino ||
      !mi_enrollment_plan_restore(&a->consumer, record->planned, sizeof(record->planned)))
    return store_adoption_fail(s, l, a, errno);
  memcpy(a->claim_id, record->fuse.claim_id, 32);
  return 1;
}
static int store_adoption_record_prepare(state *s, mi_store_lease *l, mi_original_adoption *a,
                                         nr_pool_adoption_record *record) {
  unsigned char wire[NR_POOL_ADOPTION_RECORD_BYTES];
  struct stat existing;
  if (!fstatat(l->authority, NR_POOL_ADOPTION_RECORD_NAME, &existing, AT_SYMLINK_NOFOLLOW))
    return store_adoption_existing_plan(s, l, a, record);
  if (errno != ENOENT)
    return store_adoption_fail(s, l, a, errno);
  l->validation_fd = openat(l->authority, NR_POOL_ADOPTION_RECORD_NAME,
                            O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (l->validation_fd < 0) {
    if (errno == EEXIST)
      return store_adoption_existing_plan(s, l, a, record);
    return store_adoption_fail(s, l, a, errno);
  }
  if (!mi_enrollment_plan_create(&a->consumer))
    return store_adoption_fail(s, l, a, a->consumer.first_errno);
  memset(record, 0, sizeof(*record));
  if (!store_adoption_history(a, &record->history))
    return store_adoption_fail(s, l, a, EINVAL);
  nr_pool_migration_fuse *f = &record->fuse;
  f->principal_uid = a->source_uid;
  f->database_device = record->history.database.device;
  f->database_inode = record->history.database.inode;
  f->issuer_device = record->history.issuer_lock.device;
  f->issuer_inode = record->history.issuer_lock.inode;
  f->directory_device = record->history.directory.device;
  f->directory_inode = record->history.directory.inode;
  memcpy(f->pool_id, a->old_pool_id, 32);
  memcpy(f->operation_id, a->operation_id, 32);
  memcpy(f->namespace_id, a->namespace_id, 32);
  memcpy(f->birth_id, a->birth_id, 32);
  memcpy(record->accepted_digest, a->accepted_digest, 32);
  memcpy(record->planned, a->consumer.record, sizeof(record->planned));
  if (!nr_pool_adoption_claim_id(a->accepted_digest, f, f->claim_id) ||
      !nr_pool_adoption_record_encode(&record->history, f, record->accepted_digest, record->planned,
                                      MI_ENROLLMENT_CONSUMER_KIND, wire))
    return store_adoption_fail(s, l, a, EINVAL);
  memcpy(a->claim_id, f->claim_id, 32);
  if (!mi_write_exact(l->validation_fd, wire, sizeof(wire), mi_now_ms() + 1000) ||
      fsync(l->validation_fd))
    return store_adoption_fail(s, l, a, errno);
  if (!store_close_fd(s, l, &l->validation_fd) || fsync(l->authority))
    return store_adoption_fail(s, l, a, errno);
  return 1;
}
static int store_adoption_fuse(state *s, mi_store_lease *l, const mi_original_adoption *a,
                               const nr_pool_adoption_record *record) {
  unsigned char expected[NR_POOL_MIGRATION_FUSE_BYTES], actual[NR_POOL_MIGRATION_FUSE_BYTES];
  if (!nr_pool_migration_fuse_encode(&record->fuse, expected))
    return store_adoption_fail(s, l, a, EINVAL);
  l->anchor_fd = openat(a->source_directory_fd, NR_POOL_MIGRATION_FUSE_NAME,
                        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  int created = l->anchor_fd >= 0;
  if (!created) {
    if (errno != EEXIST)
      return store_adoption_fail(s, l, a, errno);
    l->anchor_fd = openat(a->source_directory_fd, NR_POOL_MIGRATION_FUSE_NAME,
                          O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  }
  struct stat fact;
  int good =
      l->anchor_fd >= 0 && regular_owned(l->anchor_fd, created ? getuid() : a->source_uid, &fact);
  if (good && created) {
    good = !fchown(l->anchor_fd, a->source_uid, (gid_t)-1) &&
           mi_write_exact(l->anchor_fd, expected, sizeof(expected), mi_now_ms() + 1000) &&
           !fsync(l->anchor_fd);
  } else if (good) {
    good = fact.st_size == sizeof(actual) &&
           st_exact_read(l->anchor_fd, actual, sizeof(actual), 0) &&
           !memcmp(actual, expected, sizeof(actual));
  }
  if (l->anchor_fd >= 0 && !store_close_fd(s, l, &l->anchor_fd))
    good = 0;
  if (good)
    good = !fsync(a->source_directory_fd);
  return good ? 1 : store_adoption_fail(s, l, a, errno);
}
static int store_adoption_move(state *s, mi_store_lease *l, const mi_original_adoption *a,
                               const char *source, const char *target, int original_fd) {
  struct stat original, from, to;
  if (fstat(original_fd, &original))
    return store_adoption_fail(s, l, a, errno);
  if (!fstatat(l->authority, target, &to, AT_SYMLINK_NOFOLLOW)) {
    if (to.st_dev != original.st_dev || to.st_ino != original.st_ino || to.st_nlink != 1 ||
        !fstatat(a->source_directory_fd, source, &from, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
      return store_adoption_fail(s, l, a, EINVAL);
    return 1;
  }
  if (errno != ENOENT || fstatat(a->source_directory_fd, source, &from, AT_SYMLINK_NOFOLLOW) ||
      !identity(&from, &original))
    return store_adoption_fail(s, l, a, errno);
  /* Kernel no-replace semantics. Never renameat, link/unlink, copy or EXDEV fallback. */
  if (renameatx_np(a->source_directory_fd, source, l->authority, target, RENAME_EXCL))
    return store_adoption_fail(s, l, a, errno);
  if (fstatat(l->authority, target, &to, AT_SYMLINK_NOFOLLOW) || to.st_dev != original.st_dev ||
      to.st_ino != original.st_ino || to.st_nlink != 1 || fsync(a->source_directory_fd) ||
      fsync(l->authority))
    return store_adoption_fail(s, l, a, errno);
  return 1;
}
/* Births only the original IO metadata around the same two adopted inodes.
 * The fixed Entry remains responsible for Source custody and final approval. */
#include "root-store-adoption-binding.h"
#endif
