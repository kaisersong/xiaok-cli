/* Original same-inode v7 -> protected v8 transaction. Entry authorization and
 * actual FD adoption belong to the original helper, not to these data rows. */
static int nr_pool_migration_read_row(nr_session *s, int table, nr_cell *out) {
  char sql[128];
  int n = snprintf(sql, sizeof(sql), "SELECT * FROM %s", nr_tables[table]);
  if (n <= 0 || (size_t)n >= sizeof(sql))
    return 0;
  sqlite3_stmt *row = NULL;
  int good = sqlite3_prepare_v2(s->db, sql, -1, &row, NULL) == SQLITE_OK &&
             sqlite3_column_count(row) == nr_counts[table] && sqlite3_step(row) == SQLITE_ROW;
  for (int i = 0; i < nr_counts[table] && good; i++)
    good = nr_from_column(out + i, row, i);
  if (good)
    good = sqlite3_step(row) == SQLITE_DONE;
  if (row && sqlite3_finalize(row) != SQLITE_OK)
    good = 0;
  return good;
}
static int nr_pool_migration_target_rows(const nr_root_store_identity *identity, nr_cell *row,
                                         nr_cell *binding) {
  char text_value[65];
  nr_integer(row, 1);
  nr_integer(row + 1, 2);
  nr_hex32(identity->pool_id, text_value);
  int good = nr_text(row + 2, text_value);
  nr_integer(row + 3, identity->main_principal_uid);
  const nr_root_file_fact *facts[] = {&identity->directory, &identity->issuer_lock,
                                      &identity->database};
  for (int i = 0; i < 3 && good; i++) {
    good = facts[i]->device <= INT64_MAX && facts[i]->inode <= INT64_MAX;
    nr_integer(row + 4 + 3 * i, (sqlite3_int64)facts[i]->device);
    nr_integer(row + 5 + 3 * i, (sqlite3_int64)facts[i]->inode);
    nr_integer(row + 6 + 3 * i, facts[i]->mode);
  }
  nr_integer(binding, 1);
  nr_integer(binding + 1, 2);
  const unsigned char *ids[] = {identity->pool_id,       identity->namespace_id,
                                identity->birth_id,      identity->claim_id,
                                identity->anchor_digest, identity->profile_digest};
  for (int i = 0; i < 6 && good; i++) {
    nr_hex32(ids[i], text_value);
    good = nr_text(binding + 2 + i, text_value);
  }
  good = good && identity->directory.nlink <= INT64_MAX &&
         identity->issuer_lock.nlink <= INT64_MAX && identity->database.nlink <= INT64_MAX;
  nr_integer(binding + 8, identity->file_owner_uid);
  nr_integer(binding + 9, (sqlite3_int64)identity->directory.nlink);
  nr_integer(binding + 10, (sqlite3_int64)identity->issuer_lock.nlink);
  nr_integer(binding + 11, (sqlite3_int64)identity->database.nlink);
  return good;
}
static int nr_pool_migration_floor(nr_cell *next, const nr_cell *old) {
  if (!nr_clone(next, old, nr_counts[NR_FLOOR]))
    return 0;
  nr_cell_clear(next + 1);
  nr_cell_clear(next + 3);
  nr_cell_clear(next + 4);
  nr_integer(next + 2, 4);
  return nr_text(next + 1, "ordinary_runtime_root_resource_reservation_writer_v8_protected_io") &&
         nr_text(next + 3, "8dc149dce2d161efe6805547451be7284377b3157510cfd60f6717defd528c59") &&
         nr_text(next + 4, "xiaok_root_resource_reservation_writer_v7");
}
static int nr_pool_migration_changes(nr_session *s, sqlite3_int64 *out) {
  if (__builtin_available(macOS 12.3, *)) {
    *out = sqlite3_total_changes64(s->db);
    return 1;
  }
  return 0;
}
static int nr_pool_migration_checkpoint(nr_session *s, int stage) {
#ifdef NR_FIXTURE_BUILD
#ifdef NR_FIXTURE_MIGRATION_FAILURE
  if (NR_FIXTURE_MIGRATION_FAILURE == stage)
    return 0;
#endif
#endif
  (void)s;
  (void)stage;
  return 1;
}
static napi_value nr_pool_migration_error(napi_env env, nr_session *s, int primary, int extended,
                                          int committed) {
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending)
    return NULL;
  return nr_error(env, s, "ROOT_RESOURCE_MIGRATION_UNCONFIRMED", primary, extended, committed);
}
static napi_value nr_pool_migrate_original_v7(napi_env env, nr_session *s) {
  const nr_root_bootstrap_claim *claim = NULL;
  nr_original_pool_history old_history;
  nr_root_store_identity target;
  if (!s->root_io || s->created_db || s->created_lock || s->fresh_owner || s->unknown ||
      s->closed || !current(s) || !nr_root_store_claim_adopted(s->root_io, &claim) ||
      !nr_root_store_read_adoption(s->root_io, claim, &old_history, &target) ||
      !nr_io_identity_same(&s->io_identity, &target) ||
      memcmp(old_history.pool_id, target.pool_id, 32) ||
      old_history.main_principal_uid != target.main_principal_uid ||
      old_history.database.device != target.database.device ||
      old_history.database.inode != target.database.inode)
    return fail(env, "ROOT_RESOURCE_ADOPTION_CLAIM_REQUIRED");
  s->io_claim = claim;
  if (sqlite3_get_autocommit(s->db) != 1)
    return fail(env, "ROOT_RESOURCE_MIGRATION_TRANSACTION_ACTIVE");
  sqlite3_int64 changes_before = 0, changes_after = 0;
  if (!nr_pool_migration_changes(s, &changes_before))
    return fail(env, "ROOT_RESOURCE_SQLITE_API_UNAVAILABLE");
  nr_cell old_floor[NR_MAX_CELLS] = {0}, old_identity[NR_MAX_CELLS] = {0};
  nr_cell next_floor[NR_MAX_CELLS] = {0}, next_identity[NR_MAX_CELLS] = {0},
          binding[NR_MAX_CELLS] = {0};
  int began = execute(s, "BEGIN IMMEDIATE"), good = began, committed = 0;
  if (!began && sqlite3_get_autocommit(s->db) == 0)
    s->unknown = 1;
  if (good)
    good = nr_pool_migration_checkpoint(s, 1) && current(s) &&
           nr_pool_validate_ordinary_v7(env, s, &old_history) &&
           nr_pool_migration_read_row(s, NR_FLOOR, old_floor) &&
           nr_pool_migration_read_row(s, NR_POOL_IDENTITY, old_identity) &&
           nr_pool_migration_floor(next_floor, old_floor) &&
           nr_pool_migration_target_rows(&target, next_identity, binding);
  /* Only this synchronous closed DDL group receives installing authority.
   * DML follows with installing=0 and the original full-cell write frame. */
  if (good) {
    s->installing = 1;
    for (int table = 0; table < 9 && good; table++)
      for (int op = 0; op < 3 && good; op++) {
        char sql[96];
        int n = snprintf(sql, sizeof(sql), "DROP TRIGGER nr_guard_%d_%d", table, op);
        good = n > 0 && (size_t)n < sizeof(sql) && execute(s, sql);
      }
    if (good)
      good = nr_pool_migration_checkpoint(s, 2) && execute(s, schema_io_binding) &&
             nr_create_guards(s);
    s->installing = 0;
  }
  if (good)
    good = nr_pool_migration_checkpoint(s, 3) && sqlite3_get_autocommit(s->db) == 0 &&
           nr_pool_schema(s) && nr_pool_migration_changes(s, &changes_after) &&
           changes_after == changes_before;
  if (good) {
    nr_write *floor = nr_expect(s, NR_FLOOR, NR_UPDATE, old_floor, next_floor);
    nr_write *identity =
        floor ? nr_expect(s, NR_POOL_IDENTITY, NR_UPDATE, old_identity, next_identity) : NULL;
    nr_write *io_binding = identity ? nr_expect(s, NR_IO_BINDING, NR_INSERT, NULL, binding) : NULL;
    s->writing = 1;
    good = io_binding && nr_run_write(s, floor) && nr_pool_migration_checkpoint(s, 4) &&
           nr_run_write(s, identity) && nr_pool_migration_checkpoint(s, 5) &&
           nr_run_write(s, io_binding) && nr_verify_frame(s) && nr_pool_graph(env, s) &&
           current(s) && nr_pool_migration_checkpoint(s, 6) &&
           nr_pool_migration_changes(s, &changes_after) && changes_after - changes_before == 3;
  }
  int primary = good ? 0 : sqlite3_errcode(s->db),
      extended = good ? 0 : sqlite3_extended_errcode(s->db);
  if (good) {
    int returned = execute(s, "COMMIT");
    committed = sqlite3_get_autocommit(s->db) == 1;
    good = returned && committed && nr_pool_migration_checkpoint(s, 7);
    if (!good)
      s->unknown = 1;
  } else if (sqlite3_get_autocommit(s->db) == 0) {
    if (!execute(s, "ROLLBACK") || sqlite3_get_autocommit(s->db) != 1)
      s->unknown = 1;
  }
  s->installing = 0;
  nr_clear_frame(s);
  nr_cells_clear(old_floor, NR_MAX_CELLS);
  nr_cells_clear(old_identity, NR_MAX_CELLS);
  nr_cells_clear(next_floor, NR_MAX_CELLS);
  nr_cells_clear(next_identity, NR_MAX_CELLS);
  nr_cells_clear(binding, NR_MAX_CELLS);
  if (!good || s->unknown)
    return nr_pool_migration_error(env, s, primary, extended, committed);
  /* COMMIT is already a fact. Any subsequent uncertainty seals this instance;
   * neither the original pool nor its migration marker can be rolled back. */
  nr_root_store_identity confirmed;
  if (!nr_root_store_read_identity(s->root_io, &confirmed) ||
      !nr_io_identity_same(&target, &confirmed) || !current(s) || !nr_pool_graph(env, s) ||
      !nr_pool_migration_checkpoint(s, 8)) {
    s->unknown = 1;
    return nr_pool_migration_error(env, s, 0, 0, 1);
  }
  if (!nr_pool_bind_protected(s, NR_ADOPTION_COMMITTED))
    return nr_pool_migration_error(env, s, 0, 0, 1);
  nr_clear_eligible(s);
  s->io_claim = claim;
  s->fresh_owner = 1;
  s->bootstrap_status = 2;
  napi_value out = NULL;
  if (napi_create_string_utf8(env, "restored", NAPI_AUTO_LENGTH, &out) != napi_ok || !current(s)) {
    s->unknown = 1;
    return nr_pool_migration_error(env, s, 0, 0, 1);
  }
  return out;
}
