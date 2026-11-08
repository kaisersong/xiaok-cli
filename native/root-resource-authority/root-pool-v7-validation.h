/* Fixed original profile validation. This never switches the live session's
 * root_io, creates a pool, authorizes migration, or imports old capabilities. */
#include "root-store-io.h"
static int nr_pool_v7_identity_at(nr_session *s, const nr_original_pool_history *history) {
  if (!history)
    return 0;
  char pool[65];
  nr_hex32(history->pool_id, pool);
  if (!nr_intent_nonce(pool))
    return 0;
  nr_cell expected[NR_MAX_CELLS] = {0};
  nr_integer(expected, 1);
  nr_integer(expected + 1, 1);
  int good = nr_text(expected + 2, pool);
  nr_integer(expected + 3, history->main_principal_uid);
  const nr_root_file_fact *facts[] = {&history->directory, &history->issuer_lock,
                                      &history->database};
  for (int i = 0; i < 3 && good; i++) {
    good = facts[i]->device <= INT64_MAX && facts[i]->inode <= INT64_MAX &&
           facts[i]->uid == history->main_principal_uid;
    nr_integer(expected + 4 + 3 * i, (sqlite3_int64)facts[i]->device);
    nr_integer(expected + 5 + 3 * i, (sqlite3_int64)facts[i]->inode);
    nr_integer(expected + 6 + 3 * i, facts[i]->mode);
  }
  sqlite3_stmt *row = NULL;
  if (good)
    good = sqlite3_prepare_v2(s->db, "SELECT * FROM root_pool_identity", -1, &row, NULL) ==
               SQLITE_OK &&
           sqlite3_column_count(row) == 13 && sqlite3_step(row) == SQLITE_ROW;
  for (int i = 0; i < 13 && good; i++)
    good = nr_column_equal(expected + i, row, i);
  if (good)
    good = sqlite3_step(row) == SQLITE_DONE;
  if (row && sqlite3_finalize(row) != SQLITE_OK)
    good = 0;
  nr_cells_clear(expected, NR_MAX_CELLS);
  return good;
}
static int nr_pool_validate_ordinary_v7(napi_env env, nr_session *s,
                                        const nr_original_pool_history *history) {
  sqlite3_int64 count = 0;
  return floor_match(s, NR_PROFILE, NR_DIGEST, NR_GUARD, NR_SCHEMA_VERSION) &&
         nr_pool_schema_for(s, NR_POOL_ORDINARY_V7) && nr_pool_v7_identity_at(s, history) &&
         scalar(s->db, "SELECT count(*) FROM root_resource_floor", &count) && count == 1 &&
         scalar(s->db, "SELECT count(*) FROM root_resource_policy", &count) && count == 1 &&
         scalar(s->db, "SELECT count(*) FROM root_physical_policy", &count) && count == 2 &&
         nr_pool_n(s) && nr_pool_physical(env, s);
}
#ifdef NR_FIXTURE_BUILD
/* Read-only diagnostic for the real original C/SQLite preflight. The history
 * is captured from this original session; no JS facts or provider is read. */
static napi_value fixture_validate_ordinary_v7_history(napi_env env, napi_callback_info info) {
  napi_value args[2], out;
  if (!arguments(env, info, 1, args))
    return fail(env, "ROOT_RESOURCE_ARGUMENT_INVALID");
  nr_session *s = session(env, args[0], 0);
  if (!s)
    return NULL;
  if (nr_protected(s))
    return fail(env, "ROOT_RESOURCE_FIXTURE_ORDINARY_REQUIRED");
  nr_original_pool_history history = {0};
  history.main_principal_uid = (uint32_t)geteuid();
  const struct stat *source[] = {&s->directory_identity, &s->database_identity, &s->lock_identity};
  nr_root_file_fact *target[] = {&history.directory, &history.database, &history.issuer_lock};
  for (int i = 0; i < 3; i++) {
    target[i]->device = (uint64_t)source[i]->st_dev;
    target[i]->inode = (uint64_t)source[i]->st_ino;
    target[i]->uid = source[i]->st_uid;
    target[i]->mode = source[i]->st_mode;
    target[i]->nlink = source[i]->st_nlink;
  }
  sqlite3_stmt *row = NULL;
  char pool[65];
  int good = sqlite3_prepare_v2(s->db, "SELECT pool_id FROM root_pool_identity WHERE singleton=1",
                                -1, &row, NULL) == SQLITE_OK &&
             sqlite3_step(row) == SQLITE_ROW && nr_string_column(row, 0, pool, sizeof(pool), 0) &&
             nr_intent_nonce(pool) && sqlite3_step(row) == SQLITE_DONE;
  if (row && sqlite3_finalize(row) != SQLITE_OK)
    good = 0;
  if (good)
    for (int i = 0; i < 32; i++) {
      unsigned a = (unsigned char)pool[2 * i], b = (unsigned char)pool[2 * i + 1];
      history.pool_id[i] = (unsigned char)(((a <= '9' ? a - '0' : a - 'a' + 10) << 4) |
                                           (b <= '9' ? b - '0' : b - 'a' + 10));
    }
  if (!good || !nr_pool_validate_ordinary_v7(env, s, &history) || !current(s))
    return fail(env, "ROOT_RESOURCE_V7_HISTORY_UNCONFIRMED");
  if (napi_get_undefined(env, &out) != napi_ok)
    return NULL;
  return out;
}
#endif
