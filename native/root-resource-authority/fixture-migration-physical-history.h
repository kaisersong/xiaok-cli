#ifdef NR_FIXTURE_BUILD
/* Explicit synthetic historical setup. Uses the original write-frame,
 * receipt and process-intent generators. It does not create a Source key,
 * SDK permit, Main role, executable, or a natural production M/P birth. */
static int nr_fixture_migration_physical_row(nr_session *s, int kind, int index, int queued,
                                             int unknown) {
  nr_cell policy[NR_MAX_CELLS] = {0}, next[NR_MAX_CELLS] = {0}, row[NR_MAX_CELLS] = {0};
  nr_cell receipt[NR_MAX_CELLS] = {0}, intent[NR_MAX_CELLS] = {0};
  char context[] = "{\"executionClass\":\"main_turn\",\"executionRef\":\"synthetic-migration\","
                   "\"hostId\":\"host\",\"nativeRootId\":null,\"scope\":{\"principalId\":"
                   "\"principal\",\"profileId\":\"profile\",\"workspaceId\":\"workspace\"}}";
  char attempt[64], context_hash[65], identity[512], key_hash[65], key[80], metadata[2048],
      digest[65], record[65], token[65], launch[65];
  snprintf(attempt, sizeof(attempt), "synthetic-migration-%d-%d", kind, index);
  int good = nr_hash(context, context_hash);
  snprintf(identity, sizeof(identity), "%d:context:%s:%s", kind, context_hash, attempt);
  good = good && nr_hash(identity, key_hash);
  snprintf(key, sizeof(key), "%s:%s", kind == 1 ? "model" : "process", key_hash);
  snprintf(metadata, sizeof(metadata),
           "{\"attemptId\":\"%s\",\"bodyHash\":"
           "\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"context\":%s,"
           "\"resourceKind\":\"%s\"}",
           attempt, context, kind == 1 ? "model" : "process");
  good = good && nr_hash(metadata, digest);
  nr_nonce(record);
  nr_nonce(token);
  nr_nonce(launch);
  int began = good && nr_begin(s);
  good = began && nr_physical_policy(s, kind, policy) && nr_clone(next, policy, 8);
  if (good) {
    nr_integer(row + 1, kind);
    nr_integer(row + 6, policy[5].integer + 1);
    nr_integer(row + 9, queued ? 0 : 1);
    nr_integer(row + 10, 1);
    good = nr_text(row, record) && nr_text(row + 2, "main_turn") && nr_text(row + 3, key) &&
           nr_text(row + 4, metadata) && nr_text(row + 5, digest) &&
           nr_text(row + 7, queued    ? "queued"
                            : unknown ? "unknown"
                                      : "reserved") &&
           nr_text(row + 11, "direct");
    if (!queued)
      good = good && nr_text(row + 8, token) && nr_receipt(receipt, row, "reserved", token);
    if (!queued && kind == 2)
      good = good && nr_process_intent(s, row, launch, intent);
    next[5].integer++;
    if (!queued)
      next[7].integer++;
    nr_write *r = good ? nr_expect(s, NR_PH_RESOURCES, NR_INSERT, NULL, row) : NULL;
    nr_write *p = r ? nr_expect(s, NR_PH_POLICY, NR_UPDATE, policy, next) : NULL;
    nr_write *rc = p && !queued ? nr_expect(s, NR_PH_RECEIPTS, NR_INSERT, NULL, receipt) : NULL;
    nr_write *in =
        p && !queued && kind == 2 ? nr_expect(s, NR_PH_RECEIPTS, NR_INSERT, NULL, intent) : NULL;
    good = p && (queued || rc) && (queued || kind != 2 || in) && nr_run_write(s, r) &&
           nr_run_write(s, p) && (queued || nr_run_write(s, rc)) &&
           (queued || kind != 2 || nr_run_write(s, in)) && nr_commit(s);
  }
  if (!good && began && sqlite3_get_autocommit(s->db) == 0 && !execute(s, "ROLLBACK"))
    s->unknown = 1;
  nr_clear_frame(s);
  nr_cells_clear(policy, NR_MAX_CELLS);
  nr_cells_clear(next, NR_MAX_CELLS);
  nr_cells_clear(row, NR_MAX_CELLS);
  nr_cells_clear(receipt, NR_MAX_CELLS);
  nr_cells_clear(intent, NR_MAX_CELLS);
  return good;
}
static napi_value fixture_seed_migration_physical_history(napi_env env, napi_callback_info info) {
  napi_value args[2], out;
  if (!arguments(env, info, 1, args))
    return fail(env, "ROOT_RESOURCE_ARGUMENT_INVALID");
  nr_session *s = session(env, args[0], 0);
  if (!s)
    return NULL;
  if (nr_protected(s) || !s->fresh_owner ||
      !nr_pool_zero(s, "SELECT count(*) FROM root_physical_resources"))
    return fail(env, "ROOT_RESOURCE_FIXTURE_SEED_UNAVAILABLE");
  if (!nr_fixture_migration_physical_row(s, 1, 1, 0, 1) ||
      !nr_fixture_migration_physical_row(s, 1, 2, 0, 0) ||
      !nr_fixture_migration_physical_row(s, 1, 3, 1, 0) ||
      !nr_fixture_migration_physical_row(s, 2, 1, 0, 1) ||
      !nr_fixture_migration_physical_row(s, 2, 2, 1, 0) || !nr_pool_graph(env, s))
    return fail(env, "ROOT_RESOURCE_FIXTURE_SEED_UNCONFIRMED");
  if (napi_get_undefined(env, &out) != napi_ok)
    return NULL;
  return out;
}
#endif
