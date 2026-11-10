/* Exact original ordinary owner birth, shared by bare and original Main entry. */
/* Presence is only a permanent negative fence. Its bytes never authorize a
 * migration or prove that prior writers/FDs have closed. */
#define NR_POOL_MIGRATION_FUSE "root-resource-migration.fuse"
static napi_value nr_pool_refuse_fused_birth(napi_env env, nr_session *s, const char *code,
                                             int original_errno) {
  int cleanup_failed = 0, cleanup_errno = 0;
  /* At this cut only the original directory descriptor has entered. Preserve
   * the same row/descriptor if its close is unknown; never retry or clear it. */
  if (s->directory >= 0 && close(s->directory)) {
    cleanup_failed = 1;
    cleanup_errno = errno;
    s->unknown = 1;
    s->owner_env = env;
    s->next = sessions;
    sessions = s;
  } else {
    s->directory = -1;
    free(s);
  }
  napi_value message, error;
  if (napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_create_error(env, NULL, message, &error) != napi_ok)
    return NULL;
  if (!number(env, error, "osError", original_errno))
    return NULL;
  if (cleanup_failed && (!boolean(env, error, "cleanupErrorPresent", 1) ||
                         !number(env, error, "cleanupOsError", cleanup_errno)))
    return NULL;
  napi_throw(env, error);
  return NULL;
}
static napi_value open_original_kernel(napi_env env) {
  int stage = 0;
  nr_session *s = calloc(1, sizeof(*s));
  if (!s)
    return fail(env, "ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");
  s->directory = s->lock_fd = -1;
  s->birth_pid = getpid();
#ifdef NR_FIXTURE_BUILD
  if (snprintf(s->path, sizeof(s->path), "%s", NR_FIXTURE_ROOT) >= (int)sizeof(s->path))
    goto unavailable;
#else
  long size = sysconf(_SC_GETPW_R_SIZE_MAX);
  if (size < 1024)
    size = 16384;
  if (size > 1048576)
    goto unavailable;
  char *buffer = malloc((size_t)size);
  struct passwd pwd, *actual = NULL;
  if (!buffer)
    goto unavailable;
  int rc = getpwuid_r(geteuid(), &pwd, buffer, (size_t)size, &actual);
  if (rc || !actual || !pwd.pw_dir ||
      snprintf(s->path, sizeof(s->path), "%s/Library/Application Support/xiaok/runtime",
               pwd.pw_dir) >= (int)sizeof(s->path)) {
    free(buffer);
    goto unavailable;
  }
  free(buffer);
#endif
  stage = 1;
  s->directory = directory_path(s->path, 1);
  if (s->directory < 0 || fstat(s->directory, &s->directory_identity) ||
      s->directory_identity.st_uid != geteuid())
    goto unavailable;
  struct stat migration_fuse;
  if (!fstatat(s->directory, NR_POOL_MIGRATION_FUSE, &migration_fuse, AT_SYMLINK_NOFOLLOW))
    return nr_pool_refuse_fused_birth(env, s, "ROOT_RESOURCE_MIGRATION_RETIRED", 0);
  if (errno != ENOENT) {
    int original_errno = errno;
    return nr_pool_refuse_fused_birth(env, s, "ROOT_RESOURCE_MIGRATION_FUSE_UNCONFIRMED",
                                      original_errno);
  }
  stage = 2;
  s->lock_fd = open_birth_file(s->directory, "issuer.lock", &s->created_lock);
  if (s->lock_fd < 0 || !regular(s->lock_fd, &s->lock_identity))
    goto unavailable;
  if (flock(s->lock_fd, LOCK_EX | LOCK_NB)) {
    int busy = errno == EWOULDBLOCK || errno == EAGAIN;
    release(s);
    free(s);
    return fail(env, busy ? "ROOT_RESOURCE_ISSUER_BUSY" : "ROOT_RESOURCE_ISSUER_UNAVAILABLE");
  }
  stage = 3;
  int fd = open_birth_file(s->directory, "root-resource-v1.sqlite", &s->created_db);
  if (fd < 0)
    goto unavailable;
  int good = regular(fd, &s->database_identity);
  if (close(fd))
    good = 0;
  if (!good)
    goto unavailable;
  char path[PATH_MAX];
  if (snprintf(path, sizeof(path), "%s/root-resource-v1.sqlite", s->path) >= (int)sizeof(path))
    goto unavailable;
  stage = 4;
  if (sqlite3_libversion_number() < 3038000 ||
      sqlite3_open_v2(path, &s->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOFOLLOW, NULL) !=
          SQLITE_OK ||
      !current(s))
    goto unavailable;
  stage = 5;
  if (sqlite3_db_config(s->db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL) != SQLITE_OK ||
      sqlite3_db_config(s->db, SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0, NULL) != SQLITE_OK ||
      sqlite3_create_function_v2(s->db, nr_guard_name(s), -1, SQLITE_UTF8 | SQLITE_INNOCUOUS, s,
                                 guard, NULL, NULL, NULL) != SQLITE_OK)
    goto unavailable;
  stage = 6;
  if (!execute(s, "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA temp_store=MEMORY; PRAGMA "
                  "synchronous=FULL"))
    goto unavailable;
  stage = 7;
  if (sqlite3_set_authorizer(s->db, authorizer, s) != SQLITE_OK)
    goto unavailable;
  stage = 8;
  napi_value out = object(env);
  if (napi_type_tag_object(env, out, &session_tag) != napi_ok ||
      napi_wrap(env, out, s, finalize, NULL, NULL) != napi_ok)
    goto unavailable;
  s->owner_env = env;
  s->next = sessions;
  sessions = s;
  napi_object_freeze(env, out);
  return out;
unavailable: {
  int primary = s->db ? sqlite3_errcode(s->db) : 0,
      extended = s->db ? sqlite3_extended_errcode(s->db) : 0, saved_errno = errno;
  if (release(s))
    free(s);
  napi_value message, error;
  napi_create_string_utf8(env, "ROOT_RESOURCE_NATIVE_OPEN_UNAVAILABLE", NAPI_AUTO_LENGTH, &message);
  napi_create_error(env, NULL, message, &error);
  number(env, error, "nativeStage", stage);
  number(env, error, "sqliteCode", primary);
  number(env, error, "sqliteExtendedCode", extended);
  number(env, error, "osError", saved_errno);
  napi_throw(env, error);
  return NULL;
}
}
