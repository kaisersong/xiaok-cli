/* Private continuation of the same helper translation unit. */
static int store_adoption_authorization_hash(const nr_pool_adoption_record *record,
                                             unsigned char out[32]) {
  unsigned char digest[32];
  static const char domain[] = "xiaok-main-root-anchor-consume-binding-v1";
  CC_SHA256_CTX hash;
  return CC_SHA256(record->planned, sizeof(record->planned), digest) && CC_SHA256_Init(&hash) &&
         CC_SHA256_Update(&hash, domain, sizeof(domain)) &&
         CC_SHA256_Update(&hash, record->accepted_digest, 32) &&
         CC_SHA256_Update(&hash, digest, 32) && CC_SHA256_Final(out, &hash);
}
static int store_adoption_anchor(state *s, mi_store_lease *l,
                                 const nr_pool_adoption_record *record) {
  mi_store_state *q = &l->store;
  struct stat prior;
  if (!fstatat(l->authority, STORE_ANCHOR, &prior, AT_SYMLINK_NOFOLLOW))
    return 0;
  if (errno != ENOENT)
    return 0;
  memcpy(q->namespace_id, record->fuse.namespace_id, 32);
  memcpy(q->birth_id, record->fuse.birth_id, 32);
  memcpy(q->profile, l->expected_profile, 32);
  memset(q->anchor, 0, sizeof(q->anchor));
  memcpy(q->anchor, "XMANCH02", 8);
  st_p32(q->anchor + 8, 2);
  st_p32(q->anchor + 12, 320);
  memcpy(q->anchor + 16, q->namespace_id, 32);
  memcpy(q->anchor + 48, q->birth_id, 32);
  memcpy(q->anchor + 80, s->release, 32);
  memcpy(q->anchor + 112, q->profile, 32);
  if (!store_adoption_authorization_hash(record, q->anchor + 144))
    return 0;
  st_fact(q->anchor + 176, &l->authority_identity);
  st_fact(q->anchor + 208, &l->file_identity[MI_DATABASE]);
  st_fact(q->anchor + 240, &l->file_identity[MI_ISSUER_LOCK]);
  st_p32(q->anchor + 272, (uint32_t)getpid());
  st_p32(q->anchor + 276, s->birth.uid);
  st_p32(q->anchor + 280, (uint32_t)getuid());
  st_p32(q->anchor + 284, MI_BUILD_KIND);
  st_hash(q->anchor, 288, q->anchor + 288);
  l->anchor_fd = openat(l->authority, STORE_ANCHOR,
                        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (l->anchor_fd < 0 || !regular_owned(l->anchor_fd, getuid(), &q->anchor_identity) ||
      !mi_write_exact(l->anchor_fd, q->anchor, sizeof(q->anchor), mi_now_ms() + 1000) ||
      fsync(l->anchor_fd))
    return 0;
  if (!store_close_fd(s, l, &l->anchor_fd) || fsync(l->authority) || fsync(l->parent))
    return 0;
  memcpy(q->anchor_digest, q->anchor + 288, 32);
  q->receipt_fd = openat(l->authority, STORE_RECEIPTS,
                         O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (q->receipt_fd < 0 || !regular_owned(q->receipt_fd, getuid(), &q->receipt_identity) ||
      !store_append(s, l, 1, 1))
    return 0;
  memcpy(q->pool_id, record->history.pool_id, 32);
  memcpy(q->claim_id, record->fuse.claim_id, 32);
  return store_append(s, l, 2, 2) && !fsync(l->authority);
}
static int store_adopt_original_held(state *s, mi_store_lease *l, mi_original_adoption *a) {
  /* Membership must precede dereferencing the proposed Entry row or any SDK. */
  if (!mi_original_adoption_current(s, a) || l != &s->root_store ||
      l->family != MI_FAMILY_ROOT_NMP || a->unknown)
    return 0;
  if (!store_adoption_current_files(a) || !store_adoption_absent_source_sidecars(a))
    return store_adoption_fail(s, l, a, errno);
  mi_enrollment_projection projection;
  if (!mi_enrollment_decode_projection(a->accepted_projection, sizeof(a->accepted_projection),
                                       MI_ENROLLMENT_CONSUMER_KIND, &projection) ||
      projection.uid != a->source_uid || projection.mode != 1 ||
      memcmp(projection.hashes[MI_E_POOL], a->old_pool_id, 32) ||
      memcmp(projection.hashes[MI_E_OPERATION], a->operation_id, 32) ||
      memcmp(projection.hashes[MI_E_NAMESPACE], a->namespace_id, 32) ||
      memcmp(projection.hashes[MI_E_BIRTH], a->birth_id, 32) ||
      memcmp(projection.hashes[MI_E_ROOT_LEDGER], a->root_ledger_digest, 32))
    return store_adoption_fail(s, l, a, EINVAL);
  if (a->consumer.called || l->io_entered)
    return 0;
  mi_enrollment_file_init(&a->consumer);
  if (!mi_enrollment_prepare_file(&a->consumer, s->root, a->accepted_projection,
                                  sizeof(a->accepted_projection)) ||
      memcmp(a->consumer.accepted_digest, a->accepted_digest, 32))
    return store_adoption_fail(s, l, a, a->consumer.first_errno);
  l->io_entered = 1;
  int created = mkdirat(l->parent, l->directory_name, 0700) == 0;
  if (!created && errno != EEXIST)
    return store_adoption_fail(s, l, a, errno);
  l->authority =
      openat(l->parent, l->directory_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (l->authority < 0 || fstat(l->authority, &l->authority_identity) ||
      l->authority_identity.st_uid != getuid() || (l->authority_identity.st_mode & 07777) != 0700 ||
      !safe_acl(l->authority))
    return store_adoption_fail(s, l, a, errno);
  nr_pool_adoption_record record;
  if (!store_adoption_record_prepare(s, l, a, &record) || !mi_original_adoption_current(s, a) ||
      !store_adoption_fuse(s, l, a, &record))
    return 0;
  /* The new RW descriptor is opened existing-only under the continuous old
   * issuer open-description. The old readonly probe is not "upgraded". */
  l->files[MI_DATABASE] =
      openat(a->source_directory_fd, "root-resource-v1.sqlite", O_RDWR | O_CLOEXEC | O_NOFOLLOW);
  if (l->files[MI_DATABASE] < 0)
    return store_adoption_fail(s, l, a, errno);
  struct stat source;
  if (fstat(l->files[MI_DATABASE], &source) || !identity(&source, &a->source_database))
    return store_adoption_fail(s, l, a, errno);
  l->files[MI_ISSUER_LOCK] = fcntl(a->source_issuer_lock_fd, F_DUPFD_CLOEXEC, 3);
  if (l->files[MI_ISSUER_LOCK] < 0)
    return store_adoption_fail(s, l, a, errno);
  if (!store_adoption_move(s, l, a, "root-resource-v1.sqlite", l->database_name,
                           l->files[MI_DATABASE]) ||
      !store_adoption_move(s, l, a, "issuer.lock", "issuer.lock", l->files[MI_ISSUER_LOCK]))
    return 0;
  /* Restrict only the two dedicated adopted files; no recursive/shared chmod. */
  if (fchown(l->files[MI_DATABASE], getuid(), (gid_t)-1) ||
      fchown(l->files[MI_ISSUER_LOCK], getuid(), (gid_t)-1) ||
      !regular_owned(l->files[MI_DATABASE], getuid(), l->file_identity + MI_DATABASE) ||
      !regular_owned(l->files[MI_ISSUER_LOCK], getuid(), l->file_identity + MI_ISSUER_LOCK) ||
      fsync(l->files[MI_DATABASE]) || fsync(l->files[MI_ISSUER_LOCK]) ||
      !store_adoption_anchor(s, l, &record))
    return store_adoption_fail(s, l, a, errno);
  if (!mi_original_adoption_current(s, a))
    return store_adoption_fail(s, l, a, EPERM);
  a->phase = 2;
  return 1;
}
static int store_adoption_record_bound_to_io(state *s, mi_store_lease *l,
                                             const nr_pool_adoption_record *record) {
  mi_store_state *q = &l->store;
  unsigned char auth[32];
  return record->history.main_principal_uid == s->birth.uid &&
         !memcmp(record->history.pool_id, q->pool_id, 32) &&
         !memcmp(record->fuse.claim_id, q->claim_id, 32) &&
         !memcmp(record->fuse.namespace_id, q->namespace_id, 32) &&
         !memcmp(record->fuse.birth_id, q->birth_id, 32) &&
         record->history.database.device == (uint64_t)l->file_identity[MI_DATABASE].st_dev &&
         record->history.database.inode == (uint64_t)l->file_identity[MI_DATABASE].st_ino &&
         record->history.issuer_lock.device == (uint64_t)l->file_identity[MI_ISSUER_LOCK].st_dev &&
         record->history.issuer_lock.inode == (uint64_t)l->file_identity[MI_ISSUER_LOCK].st_ino &&
         store_adoption_authorization_hash(record, auth) && !memcmp(auth, q->anchor + 144, 32);
}
static int store_adoption_reply(state *s, mi_store_lease *l, mi_frame *reply, unsigned char *out) {
  if (l != &s->root_store || l->unknown || l->closed)
    return 0;
  mi_original_adoption *a = mi_original_adoption_for_state(s);
  if (!mi_original_adoption_current(s, a))
    return 0;
  nr_pool_adoption_record record;
  unsigned char wire[NR_POOL_ADOPTION_RECORD_BYTES];
  if (!store_adoption_record_read(s, l, &record, wire) ||
      !store_adoption_record_bound_to_io(s, l, &record))
    return store_adoption_fail(s, l, a, errno);
  store_identity(s, l, out);
  if (!nr_original_pool_history_encode(&record.history, out + MI_STORE_IDENTITY_BYTES))
    return store_adoption_fail(s, l, a, EINVAL);
  reply->payload_length = MI_STORE_IDENTITY_BYTES + NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES;
  return 1;
}
static int store_adoption_bind(state *s, mi_store_lease *l, const unsigned char *input) {
  if (l != &s->root_store || l->unknown || l->closed || st_u32(input) != 3)
    return 0;
  mi_store_state *q = &l->store;
  if (q->phase < 2 || memcmp(input + 4, q->namespace_id, 32) ||
      memcmp(input + 36, q->pool_id, 32) || memcmp(input + 68, q->claim_id, 32) ||
      memcmp(input + 100, q->anchor_digest, 32) || memcmp(input + 132, q->profile, 32))
    return 0;
  mi_original_adoption *a = mi_original_adoption_for_state(s);
  if (!mi_original_adoption_current(s, a))
    return 0;
  nr_pool_adoption_record record;
  unsigned char wire[NR_POOL_ADOPTION_RECORD_BYTES];
  if (!store_adoption_record_read(s, l, &record, wire) ||
      !store_adoption_record_bound_to_io(s, l, &record))
    return store_adoption_fail(s, l, a, errno);
  mi_enrollment_file_consumer *consumer = &a->consumer;
  if (consumer->commit_attempted) {
    if (q->phase != 3 || consumer->unknown || consumer->error_present ||
        consumer->accepted.fd >= 0 || consumer->file.fd >= 0)
      return store_adoption_fail(s, l, a, EINVAL);
    /* A new current read of the same committed operation: restore its existing
     * plan with zero entropy; never clear a failed/held consumer. */
    mi_enrollment_file_init(consumer);
  }
  if (!consumer->called) {
    mi_enrollment_file_init(consumer);
    if (!mi_enrollment_prepare_file(consumer, s->root, a->accepted_projection,
                                    sizeof(a->accepted_projection)) ||
        !mi_enrollment_plan_restore(consumer, record.planned, sizeof(record.planned)))
      return store_adoption_fail(s, l, a, consumer->first_errno);
  }
  if (!consumer->planned || memcmp(consumer->record, record.planned, sizeof(record.planned)) ||
      memcmp(consumer->accepted_digest, record.accepted_digest, 32) ||
      !mi_enrollment_consume_prepared(consumer))
    return store_adoption_fail(s, l, a, consumer->first_errno);
  if (q->phase == 2 && !store_append(s, l, 3, 3))
    return store_adoption_fail(s, l, a, errno);
  return mi_original_adoption_current(s, a) && q->phase == 3;
}
static int store_adoption_close_entry(state *s, mi_store_lease *l) {
  mi_original_adoption *a = mi_original_adoption_for_state(s);
  if (!a) {
    int present = store_adoption_presence(s, l);
    return present == 0;
  }
  /* The fixed negative port validates its private member before touching the
   * row, including after current/Source has failed. No positive check here. */
  if (!mi_original_adoption_close_owned(s, a)) {
    l->unknown = 1;
    s->unknown = 1;
    return 0;
  }
  return 1;
}
