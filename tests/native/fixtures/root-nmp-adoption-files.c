#ifndef MI_ENROLLMENT_COMPONENT_BUILD
#error This fixed Native Entry proof is a component fixture, not production approval
#endif
#define main original_helper_main
#include "main-installation-helper.c"
#undef main
#define main original_codec_vector_main
#include "main-enrollment-codec.c"
#undef main
#include "root-store-adoption.h"
static state original_state;
static mi_original_adoption original_entry;
static int mi_original_adoption_current(state *s, const mi_original_adoption *a) {
  if (s != &original_state || a != &original_entry)
    return 0;
  if (a->unknown)
    return 0;
  struct stat db, lock, dir;
  return !fstat(a->source_database_fd, &db) && !fstat(a->source_issuer_lock_fd, &lock) &&
         !fstat(a->source_directory_fd, &dir) && db.st_dev == a->source_database.st_dev &&
         db.st_ino == a->source_database.st_ino && db.st_nlink == 1 &&
         lock.st_dev == a->source_issuer_lock.st_dev &&
         lock.st_ino == a->source_issuer_lock.st_ino && lock.st_nlink == 1 &&
         dir.st_dev == a->source_directory.st_dev && dir.st_ino == a->source_directory.st_ino;
}
static void mi_original_adoption_unknown(state *s, const mi_original_adoption *a, int error) {
  (void)error;
  if (s == &original_state && a == &original_entry)
    original_entry.unknown = 1;
}
static mi_original_adoption *mi_original_adoption_for_state(state *s) {
  return s == &original_state ? &original_entry : NULL;
}
static int mi_original_adoption_close_owned(state *s, const mi_original_adoption *row) {
  if (s != &original_state || row != &original_entry)
    return 0;
  mi_original_adoption *a = &original_entry;
  if (a->unknown)
    return 0;
  int good = mi_enrollment_file_close(&a->consumer);
  int *fds[] = {&a->source_database_fd, &a->source_issuer_lock_fd, &a->source_directory_fd};
  for (int i = 0; i < 3; i++)
    if (*fds[i] >= 0) {
      if (close(*fds[i]))
        good = 0;
      else
        *fds[i] = -1;
    }
  if (!good)
    a->unknown = 1;
  return good;
}
static int from_hex(const char *s, unsigned char out[32]) {
  if (strlen(s) != 64)
    return 0;
  for (int i = 0; i < 32; i++) {
    unsigned a = (unsigned char)s[2 * i], b = (unsigned char)s[2 * i + 1];
    if (!((a >= '0' && a <= '9') || (a >= 'a' && a <= 'f')) ||
        !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')))
      return 0;
    out[i] = (unsigned char)(((a <= '9' ? a - '0' : a - 'a' + 10) << 4) |
                             (b <= '9' ? b - '0' : b - 'a' + 10));
  }
  return 1;
}
int main(int argc, char **argv) {
  if (argc != 5 && argc != 6)
    return 64;
  int restore = argc == 6 && !strcmp(argv[5], "ipc-restore");
  int ipc = argc == 6 && (!strcmp(argv[5], "ipc") || restore);
  if (argc == 6 && !ipc)
    return 64;
  state *s = &original_state;
  mi_original_adoption *a = &original_entry;
  memset(s, 0, sizeof(*s));
  memset(a, 0, sizeof(*a));
  s->root = s->listener = -1;
  for (int i = 0; i < MAX_CHANNELS; i++)
    s->connections[i].fd = -1;
  for (int i = 0; i < MI_AUTHORITY_MAX_LEASES; i++)
    store_lease_init(s->families + i);
  s->root = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  a->source_directory_fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (s->root < 0 || a->source_directory_fd < 0)
    return 65;
  a->source_uid = getuid();
  s->birth.uid = getuid();
  memset(s->birth.nonce, 8, 32);
  memset(s->release, 9, 32);
  if (!from_hex(argv[3], a->old_pool_id) || !from_hex(argv[4], a->root_ledger_digest))
    return 67;
  mi_store_lease *l = &s->root_store;
  store_lease_init(l);
  l->parent = s->root;
  l->family = MI_FAMILY_ROOT_NMP;
  memcpy(l->directory_name, MI_AUTHORITY_BASENAME, sizeof(MI_AUTHORITY_BASENAME));
  memcpy(l->database_name, MI_DATABASE_BASENAME, sizeof(MI_DATABASE_BASENAME));
  snprintf(l->journal_name, sizeof(l->journal_name), "%s-journal", l->database_name);
  snprintf(l->wal_name, sizeof(l->wal_name), "%s-wal", l->database_name);
  snprintf(l->shm_name, sizeof(l->shm_name), "%s-shm", l->database_name);
  static const char profile[] = "xiaok-original-root-store-io-v2";
  st_hash(profile, sizeof(profile) - 1, l->expected_profile);
  if (ipc && (fstat(s->root, &s->root_identity) || !closure(s)))
    return 72;
  if (restore) {
    if (!store_open_at(s, l))
      return 74;
    a->source_database_fd =
        openat(l->authority, l->database_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    a->source_issuer_lock_fd = fcntl(l->files[MI_ISSUER_LOCK], F_DUPFD_CLOEXEC, 3);
  } else {
    a->source_database_fd = openat(a->source_directory_fd, "root-resource-v1.sqlite",
                                   O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    a->source_issuer_lock_fd =
        openat(a->source_directory_fd, "issuer.lock", O_RDWR | O_NOFOLLOW | O_CLOEXEC);
    if (a->source_issuer_lock_fd < 0 || flock(a->source_issuer_lock_fd, LOCK_EX | LOCK_NB))
      return 66;
  }
  if (a->source_database_fd < 0 || a->source_issuer_lock_fd < 0 ||
      fstat(a->source_directory_fd, &a->source_directory) ||
      fstat(a->source_database_fd, &a->source_database) ||
      fstat(a->source_issuer_lock_fd, &a->source_issuer_lock))
    return 66;
  mi_enrollment_projection p;
  vector(&p);
  p.uid = getuid();
  for (int i = 0; i < 3; i++)
    p.facts[i].uid = getuid();
  memcpy(p.hashes[MI_E_POOL], a->old_pool_id, 32);
  memcpy(p.hashes[MI_E_ROOT_LEDGER], a->root_ledger_digest, 32);
  unsigned char core[32];
  if (!mi_enrollment_encode_projection(&p, a->accepted_projection) ||
      !mi_enrollment_claim_core_hash(a->accepted_projection, sizeof(a->accepted_projection), 2,
                                     core))
    return 68;
  memcpy(p.hashes[MI_E_COMMITTED_COMMAND], core, 32);
  if (!mi_enrollment_encode_projection(&p, a->accepted_projection))
    return 69;
  memcpy(a->operation_id, p.hashes[MI_E_OPERATION], 32);
  memcpy(a->namespace_id, p.hashes[MI_E_NAMESPACE], 32);
  memcpy(a->birth_id, p.hashes[MI_E_BIRTH], 32);
  static const char accepted_domain[] = "xiaok-main-root-accepted-file-v1";
  if (!mi_e_hash(accepted_domain, sizeof(accepted_domain), a->accepted_projection,
                 sizeof(a->accepted_projection), a->accepted_digest))
    return 70;
  if (restore) {
    int accepted =
        openat(s->root, "main-root-family.enrollment", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (accepted < 0 ||
        !st_exact_read(accepted, a->accepted_projection, sizeof(a->accepted_projection), 0) ||
        close(accepted) ||
        !mi_enrollment_decode_projection(a->accepted_projection, sizeof(a->accepted_projection), 2,
                                         &p))
      return 71;
    memcpy(a->operation_id, p.hashes[MI_E_OPERATION], 32);
    memcpy(a->namespace_id, p.hashes[MI_E_NAMESPACE], 32);
    memcpy(a->birth_id, p.hashes[MI_E_BIRTH], 32);
    if (!mi_e_hash(accepted_domain, sizeof(accepted_domain), a->accepted_projection,
                   sizeof(a->accepted_projection), a->accepted_digest))
      return 70;
  } else {
    int accepted = openat(s->root, "main-root-family.enrollment",
                          O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (accepted < 0 ||
        !mi_write_exact(accepted, a->accepted_projection, sizeof(a->accepted_projection),
                        mi_now_ms() + 1000) ||
        fsync(accepted) || close(accepted) || fsync(s->root))
      return 71;
  }
  int good = 1;
  if (restore) {
    nr_pool_adoption_record record;
    unsigned char wire[NR_POOL_ADOPTION_RECORD_BYTES];
    mi_enrollment_file_init(&a->consumer);
    good = store_adoption_record_read(s, l, &record, wire) &&
           store_adoption_record_bound_to_io(s, l, &record) &&
           mi_enrollment_prepare_file(&a->consumer, s->root, a->accepted_projection,
                                      sizeof(a->accepted_projection)) &&
           mi_enrollment_plan_restore(&a->consumer, record.planned, sizeof(record.planned));
  } else
    good = store_adopt_original_held(s, l, a);
  struct stat moved = {0};
  if (good)
    good = !fstatat(l->authority, l->database_name, &moved, AT_SYMLINK_NOFOLLOW) &&
           moved.st_dev == a->source_database.st_dev && moved.st_ino == a->source_database.st_ino &&
           (l->store.phase == 2 || (restore && l->store.phase == 3)) &&
           !memcmp(l->store.pool_id, a->old_pool_id, 32);
  printf("{\"kind\":\"actual-original-inode-adoption-files\",\"good\":%d,\"errno\":%d,\"unknown\":%"
         "d,\"phase\":%d,\"device\":%llu,\"inode\":%llu,\"productionQualified\":false,"
         "\"genuineEntryApproval\":false}\n",
         good, errno, a->unknown, l->store.phase, (unsigned long long)moved.st_dev,
         (unsigned long long)moved.st_ino);
  if (ipc && good) {
    signal(SIGPIPE, SIG_IGN);
    signal(SIGCHLD, SIG_DFL);
    signal(SIGTERM, stop_signal);
    signal(SIGINT, stop_signal);
    if (!start_listener(s) || !launch(s))
      return 73;
    serve(s);
    if (!s->child_exited && s->child > 0) {
      kill(s->child, SIGTERM);
      pid_t result;
      do {
        result = waitpid(s->child, &s->child_status, 0);
      } while (result < 0 && errno == EINTR);
      s->child_exited = result == s->child;
    }
    int joined = mi_original_adoption_close_owned(s, a);
    int cleaned = cleanup(s);
    printf(
        "{\"kind\":\"actual-adoption-root-io-child-reaped\",\"pid\":%ld,\"reaped\":%d,\"status\":%"
        "d,\"unknown\":%d,\"sourceJoined\":%d,\"helperClosed\":%d,\"productionQualified\":false}\n",
        (long)s->child, s->child_exited, s->child_status, s->unknown, joined, cleaned);
    return joined && cleaned && s->child_exited && WIFEXITED(s->child_status) &&
                   WEXITSTATUS(s->child_status) == 0
               ? 0
               : 1;
  }
  int cleanup = mi_enrollment_file_close(&a->consumer);
  if (!close_file_lease(s))
    cleanup = 0;
  int *fds[] = {&a->source_database_fd, &a->source_issuer_lock_fd, &a->source_directory_fd,
                &s->root};
  for (int i = 0; i < 4; i++)
    if (*fds[i] >= 0) {
      if (close(*fds[i]))
        cleanup = 0;
      else
        *fds[i] = -1;
    }
  return good && cleanup ? 0 : 1;
}
