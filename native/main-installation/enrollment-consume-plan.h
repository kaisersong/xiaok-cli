#ifndef XIAOK_MAIN_ROOT_ENROLLMENT_CONSUME_PLAN_H
#define XIAOK_MAIN_ROOT_ENROLLMENT_CONSUME_PLAN_H
/* Included only by the original private file consumer. These bytes bind its
 * actual accepted FD. A plan grants neither Source/migration authority nor
 * consumption/BOUND. The original adoption owner persists the plan before SQL.
 * No new pathname, nonce provider, JS export, MAC key or permission flag lives here. */
static MI_E_UNUSED int mi_e_plan_current(mi_enrollment_file_consumer *s) {
  unsigned char expected[MI_ENROLLMENT_ACCEPTED_BYTES];
  if (s->accepted.fd < 0 || s->accepted.close_entered || !s->prepared ||
      s->unknown || s->error_present)
    return mi_e_file_fail(s, "MI_CONSUME_NOT_PREPARED", EINVAL, 0);
  if (!mi_enrollment_encode_projection(&s->projection, expected))
    return mi_e_file_fail(s, "MI_CONSUME_PROJECTION_INVALID", EINVAL, 0);
  if (!mi_e_accepted_current(s))
    return 0;
  return mi_e_accepted_bytes(s, expected, sizeof(expected));
}
static MI_E_UNUSED int mi_enrollment_prepare_file(mi_enrollment_file_consumer *s, int borrowed_root,
                                                  const unsigned char *projection, size_t bytes) {
  if (!s || s->called)
    return 0;
  s->called = 1;
  s->metadata_root = borrowed_root;
  if (!mi_e_prepare_projection(s, borrowed_root, projection, bytes) ||
      !mi_e_read_accepted(s, projection, bytes))
    return 0;
  s->prepared = 1;
  return !s->unknown && !s->error_present;
}
/* The adoption owner must first own the new durable plan's O_EXCL birth. A
 * random-source error is terminal for this row: no second entropy attempt. */
static MI_E_UNUSED int mi_enrollment_plan_create(mi_enrollment_file_consumer *s) {
  if (!s)
    return 0;
  if (s->plan_attempted)
    return mi_e_file_fail(s, "MI_CONSUME_PLAN_ALREADY_SET", EINVAL, 0);
  if (!mi_e_plan_current(s))
    return 0;
  s->plan_attempted = 1;
  if (s->projection.mode != 1)
    return mi_e_file_fail(s, "MI_CONSUME_RESTORE_MISSING", EPERM, 0);
  mi_e_consume_bindings(s);
  if (SecRandomCopyBytes(kSecRandomDefault, 32, s->consume.hashes[5]) != errSecSuccess ||
      !mi_e_nonzero(s->consume.hashes[5], 32))
    return mi_e_file_fail(s, "MI_CONSUME_NONCE_UNKNOWN", EIO, 0);
  if (!mi_enrollment_encode_consume(&s->consume, s->record))
    return mi_e_file_fail(s, "MI_CONSUME_ENCODING_INVALID", EINVAL, 0);
  memcpy(s->planned_record, s->record, sizeof(s->record));
  s->planned = 1;
  return 1;
}
/* The caller is the fixed Native adoption owner reading its original protected
 * plan, not a JS/provider-supplied receipt. This validation grants no authority. */
static MI_E_UNUSED int mi_enrollment_plan_restore(mi_enrollment_file_consumer *s,
                                                  const unsigned char *planned, size_t bytes) {
  if (!s)
    return 0;
  if (s->plan_attempted)
    return mi_e_file_fail(s, "MI_CONSUME_PLAN_ALREADY_SET", EINVAL, 0);
  if (!mi_e_plan_current(s))
    return 0;
  s->plan_attempted = 1;
  if (!planned || bytes != sizeof(s->record) ||
      !mi_enrollment_decode_consume(planned, bytes, MI_ENROLLMENT_CONSUMER_KIND, &s->consume))
    return mi_e_file_fail(s, "MI_CONSUME_PLAN_INVALID", EINVAL, 1);
  if (!mi_e_file_bindings(s))
    return 0;
  memcpy(s->record, planned, sizeof(s->record));
  memcpy(s->planned_record, planned, sizeof(s->planned_record));
  s->planned = 1;
  return 1;
}
static MI_E_UNUSED int mi_e_commit_planned(mi_enrollment_file_consumer *s) {
  struct stat prior;
  errno = 0;
  if (!fstatat(s->metadata_root, s->name, &prior, AT_SYMLINK_NOFOLLOW)) {
    if (!mi_e_file_open_existing(s))
      return 0;
    if (memcmp(s->record, s->planned_record, sizeof(s->record)))
      return mi_e_file_fail(s, "MI_CONSUME_PLAN_MISMATCH", EINVAL, 1);
    return 1;
  }
  if (errno != ENOENT)
    return mi_e_file_fail(s, "MI_CONSUME_PROBE_UNKNOWN", errno, 1);
#ifndef MI_ENROLLMENT_COMPONENT_BUILD
  /* Planning does not relax the original production migration/restore gate. */
  return mi_e_file_fail(
      s, s->projection.mode == 1 ? "MI_MIGRATION_NOT_IMPLEMENTED" : "MI_CONSUME_RESTORE_MISSING",
      EPERM, 0);
#else
  if (s->projection.mode != 1)
    return mi_e_file_fail(s, "MI_CONSUME_RESTORE_MISSING", EPERM, 0);
  memcpy(s->record, s->planned_record, sizeof(s->record));
  return mi_e_write_loaded(s, s->metadata_root);
#endif
}
static MI_E_UNUSED int mi_enrollment_consume_prepared(mi_enrollment_file_consumer *s) {
  if (!s)
    return 0;
  if (s->commit_attempted)
    return mi_e_file_fail(s, "MI_CONSUME_ALREADY_ATTEMPTED", EINVAL, 0);
  s->commit_attempted = 1;
  int good = s->planned && mi_e_plan_current(s);
  if (!s->planned)
    mi_e_file_fail(s, "MI_CONSUME_PLAN_REQUIRED", EINVAL, 0);
  if (good)
    good = mi_e_commit_planned(s);
  if (good)
    good = mi_e_plan_current(s);
  /* Negative is unconditional, including failed preconditions and errno zero. */
  if (!mi_enrollment_file_close(s))
    good = 0;
  if (good && (s->status == MI_E_FILE_CREATED || s->status == MI_E_FILE_EXISTING)) {
    errno = 0;
    if (fsync(s->metadata_root))
      good = mi_e_file_fail(s, "MI_CONSUME_DIRECTORY_UNKNOWN", errno, 1);
  }
  return good && !s->unknown && !s->error_present;
}
#endif
