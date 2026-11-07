#include "protected-sqlite-facade.h"
#include "original-root-io-vfs.h"
#include <limits.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct ps_namespace ps_namespace;
typedef struct ps_database ps_database;
typedef struct ps_statement ps_statement;
typedef struct ps_cursor ps_cursor;
typedef struct ps_udf ps_udf;
struct ps_namespace {
  ps_namespace *next;
  napi_env env;
  pid_t pid;
  pthread_t thread;
  nr_root_store_io *io;
  napi_ref object, db_ctor, stmt_ctor;
  ps_database *db;
  ps_statement *creating;
  int entered, closed, teardown;
};
struct ps_database {
  ps_namespace *ns;
  napi_ref object;
  nr_original_root_vfs *family;
  sqlite3 *sql;
  ps_statement *statements;
  ps_cursor *cursors;
  napi_ref thrown;
  int thrown_present, busy, sealed, closed, unknown;
};
struct ps_statement {
  ps_statement *next;
  ps_database *db;
  napi_ref object;
  sqlite3_stmt *sql;
  int active, read_big;
};
struct ps_cursor {
  ps_cursor *next;
  ps_statement *stmt;
  ps_database *db;
  napi_ref object, held_stmt;
  int closed;
};
struct ps_udf {
  ps_database *db;
  napi_ref fn;
};
static _Thread_local ps_namespace *namespaces;

#include "protected-sqlite-lifecycle.h"

static int bind_value(napi_env e, sqlite3_stmt *s, int index, napi_value v) {
  napi_valuetype type;
  if (napi_typeof(e, v, &type) != napi_ok)
    return SQLITE_MISUSE;
  switch (type) {
  case napi_null:
    return sqlite3_bind_null(s, index);
  case napi_number: {
    double n;
    napi_get_value_double(e, v, &n);
    if (!isfinite(n) || (floor(n) == n && fabs(n) > 9007199254740991.0))
      return SQLITE_RANGE;
    if (floor(n) == n && !(n == 0 && signbit(n)))
      return sqlite3_bind_int64(s, index, (sqlite3_int64)n);
    return sqlite3_bind_double(s, index, n);
  }
  case napi_bigint: {
    int64_t n;
    bool lossless = false;
    if (napi_get_value_bigint_int64(e, v, &n, &lossless) != napi_ok || !lossless)
      return SQLITE_RANGE;
    return sqlite3_bind_int64(s, index, n);
  }
  case napi_string: {
    char *p;
    size_t n;
    if (!string_value(e, v, &p, &n, 1))
      return SQLITE_MISUSE;
    int rc = sqlite3_bind_text(s, index, p, (int)n, SQLITE_TRANSIENT);
    free(p);
    return rc;
  }
  case napi_object: {
    void *p;
    size_t n;
    if (!binary(e, v, &p, &n))
      return SQLITE_MISMATCH;
    return sqlite3_bind_blob(s, index, p ? p : "", (int)n, SQLITE_TRANSIENT);
  }
  default:
    return SQLITE_MISMATCH;
  }
}
static int bind_all(ps_statement *s, call *c) {
  napi_env e = s->db->ns->env;
  if (s->active || !s->sql) {
    sql_error(s->db, SQLITE_MISUSE, "statement is busy or closed");
    return 0;
  }
  if (c->argc > (size_t)sqlite3_bind_parameter_count(s->sql)) {
    fail(e, "ERR_OUT_OF_RANGE", "too many SQLite parameters");
    return 0;
  }
  sqlite3_reset(s->sql);
  sqlite3_clear_bindings(s->sql);
  for (size_t k = 0; k < c->argc; k++) {
    int rc = bind_value(e, s->sql, (int)k + 1, c->argv[k]);
    if (rc != SQLITE_OK) {
      sqlite3_reset(s->sql);
      fail(e, rc == SQLITE_RANGE ? "ERR_OUT_OF_RANGE" : "ERR_INVALID_ARG_TYPE",
           "unsupported SQLite parameter");
      return 0;
    }
  }
  return 1;
}
static napi_value integer_value(napi_env e, sqlite3_int64 n, int big) {
  napi_value v;
  if (big) {
    if (napi_create_bigint_int64(e, n, &v) != napi_ok)
      return NULL;
  } else {
    if (n > INT64_C(9007199254740991) || n < -INT64_C(9007199254740991))
      return fail(e, "ERR_OUT_OF_RANGE", "SQLite integer exceeds safe Number range");
    if (napi_create_double(e, (double)n, &v) != napi_ok)
      return NULL;
  }
  return v;
}
static napi_value column(napi_env e, sqlite3_stmt *s, int col, int big) {
  napi_value v = NULL;
  switch (sqlite3_column_type(s, col)) {
  case SQLITE_NULL:
    return null_value(e);
  case SQLITE_INTEGER:
    return integer_value(e, sqlite3_column_int64(s, col), big);
  case SQLITE_FLOAT:
    napi_create_double(e, sqlite3_column_double(s, col), &v);
    return v;
  case SQLITE_TEXT:
    napi_create_string_utf8(e, (const char *)sqlite3_column_text(s, col),
                            (size_t)sqlite3_column_bytes(s, col), &v);
    return v;
  case SQLITE_BLOB: {
    size_t size = (size_t)sqlite3_column_bytes(s, col);
    void *out = NULL;
    napi_value backing;
    if (napi_create_arraybuffer(e, size, &out, &backing) != napi_ok)
      return NULL;
    if (size)
      memcpy(out, sqlite3_column_blob(s, col), size);
    napi_create_typedarray(e, napi_uint8_array, size, backing, 0, &v);
    return v;
  }
  default:
    return NULL;
  }
}
static napi_value row(ps_statement *s) {
  napi_env e = s->db->ns->env;
  napi_value out;
  if (napi_create_object(e, &out) != napi_ok)
    return NULL;
  for (int k = 0; k < sqlite3_column_count(s->sql); k++) {
    napi_value v = column(e, s->sql, k, s->read_big);
    if (!v || !data(e, out, sqlite3_column_name(s->sql, k), v))
      return NULL;
  }
  return out;
}
static napi_value statement_read(napi_env e, napi_callback_info i, int mode) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_statement *s = statement_call(e, &c);
  if (!s) {
    free(c.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original statement required");
  }
  ps_database *d = s->db;
  if (!enter(d)) {
    free(c.argv);
    return NULL;
  }
  if (!bind_all(s, &c)) {
    free(c.argv);
    d->busy = 0;
    return NULL;
  }
  free(c.argv);
  int rc = SQLITE_OK;
  napi_value out = NULL;
  if (mode == 1)
    napi_create_array(e, &out);
  uint32_t count = 0;
  while ((rc = sqlite3_step(s->sql)) == SQLITE_ROW) {
    if (mode == 2)
      continue;
    napi_value value = row(s);
    if (!value) {
      rc = SQLITE_ERROR;
      break;
    }
    if (mode == 0) {
      out = value;
      break;
    }
    char index[16];
    snprintf(index, sizeof(index), "%u", count++);
    if (!data(e, out, index, value)) {
      rc = SQLITE_ERROR;
      break;
    }
  }
  if (mode == 2 && rc == SQLITE_DONE) {
    napi_create_object(e, &out);
    napi_value changes = integer_value(e, sqlite3_changes64(d->sql), s->read_big),
               id = integer_value(e, sqlite3_last_insert_rowid(d->sql), s->read_big);
    if (!changes || !id || !data(e, out, "changes", changes) ||
        !data(e, out, "lastInsertRowid", id))
      out = NULL;
  }
  if (mode == 0 && rc == SQLITE_DONE)
    out = undef(e);
  sqlite3_reset(s->sql);
  d->busy = 0;
  bool pending = false;
  napi_is_exception_pending(e, &pending);
  if (d->thrown_present)
    return sql_error(d, rc, NULL);
  if (pending)
    return NULL;
  if (rc != SQLITE_ROW && rc != SQLITE_DONE)
    return sql_error(d, rc, NULL);
  return out;
}
static napi_value stmt_get(napi_env e, napi_callback_info i) {
  return statement_read(e, i, 0);
}
static napi_value stmt_all(napi_env e, napi_callback_info i) {
  return statement_read(e, i, 1);
}
static napi_value stmt_run(napi_env e, napi_callback_info i) {
  return statement_read(e, i, 2);
}
static napi_value stmt_big(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_statement *s = statement_call(e, &c);
  if (!s) {
    free(c.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original statement required");
  }
  napi_valuetype t;
  bool b = false;
  int good = c.argc == 1 && napi_typeof(e, c.argv[0], &t) == napi_ok && t == napi_boolean &&
             napi_get_value_bool(e, c.argv[0], &b) == napi_ok;
  free(c.argv);
  if (!good || s->active)
    return fail(e, "ERR_INVALID_ARG_TYPE",
                "setReadBigInts requires a boolean on an idle statement");
  s->read_big = b;
  return c.self;
}
static napi_value cursor_next(napi_env e, napi_callback_info i) {
  call a;
  if (!arguments(e, i, &a))
    return NULL;
  ps_cursor *c = cursor_member(e, a.self);
  free(a.argv);
  if (!c || a.context != c)
    return fail(e, "ERR_SQLITE_ERROR", "original cursor required");
  napi_value out, v;
  napi_create_object(e, &out);
  if (c->closed) {
    napi_get_boolean(e, true, &v);
    data(e, out, "done", v);
    data(e, out, "value", null_value(e));
    return out;
  }
  ps_database *d = c->stmt->db;
  if (!enter(d))
    return NULL;
  int rc = sqlite3_step(c->stmt->sql);
  napi_value value = rc == SQLITE_ROW ? row(c->stmt) : NULL;
  d->busy = 0;
  if (rc != SQLITE_ROW || !value)
    close_cursor(c);
  if (d->thrown_present)
    return sql_error(d, rc, NULL);
  bool pending = false;
  napi_is_exception_pending(e, &pending);
  if (pending)
    return NULL;
  if (rc != SQLITE_ROW && rc != SQLITE_DONE)
    return sql_error(d, rc, NULL);
  napi_get_boolean(e, rc == SQLITE_DONE, &v);
  data(e, out, "done", v);
  data(e, out, "value", value ? value : null_value(e));
  return out;
}
static napi_value cursor_return(napi_env e, napi_callback_info i) {
  call a;
  if (!arguments(e, i, &a))
    return NULL;
  ps_cursor *c = cursor_member(e, a.self);
  free(a.argv);
  if (!c || a.context != c)
    return fail(e, "ERR_SQLITE_ERROR", "original cursor required");
  close_cursor(c);
  napi_value out, b;
  napi_create_object(e, &out);
  napi_get_boolean(e, true, &b);
  data(e, out, "done", b);
  data(e, out, "value", null_value(e));
  return out;
}
static napi_value stmt_iterator(napi_env e, napi_callback_info i) {
  call a;
  if (!arguments(e, i, &a))
    return NULL;
  ps_statement *s = statement_call(e, &a);
  if (!s) {
    free(a.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original statement required");
  }
  ps_database *d = s->db;
  if (!enter(d)) {
    free(a.argv);
    return NULL;
  }
  int good = bind_all(s, &a);
  free(a.argv);
  d->busy = 0;
  if (!good)
    return NULL;
  ps_cursor *c = calloc(1, sizeof(*c));
  if (!c)
    return fail(e, "ERR_MEMORY_ALLOCATION_FAILED", "SQLite cursor custody");
  c->stmt = s;
  c->db = d;
  c->next = d->cursors;
  d->cursors = c;
  s->active = 1;
  napi_value out;
  napi_create_object(e, &out);
  if (napi_create_reference(e, a.self, 1, &c->held_stmt) != napi_ok ||
      napi_create_reference(e, out, 0, &c->object) != napi_ok ||
      napi_add_finalizer(e, out, c, cursor_gc, NULL, NULL) != napi_ok)
    return NULL;
  // A saved method still carries c as callback data. Keep its original cursor
  // alive through a JS edge, so this address cannot be recycled underneath it.
  // This is a collectible JS cycle, not a permanent strong napi_ref root. The
  // symbol is a lifetime edge, never an authority or an authorization secret.
  const char *names[] = {"next", "return"};
  napi_callback callbacks[] = {cursor_next, cursor_return};
  for (size_t k = 0; k < 2; k++) {
    napi_value fn, edge;
    if (napi_create_function(e, names[k], NAPI_AUTO_LENGTH, callbacks[k], c, &fn) != napi_ok ||
        napi_create_symbol(e, NULL, &edge) != napi_ok)
      return NULL;
    napi_property_descriptor keep = {.name = edge, .value = out, .attributes = napi_default};
    napi_property_descriptor method = {.utf8name = names[k], .value = fn};
    if (napi_define_properties(e, fn, 1, &keep) != napi_ok ||
        napi_define_properties(e, out, 1, &method) != napi_ok)
      return NULL;
  }
  return out;
}

static void udf_destroy(void *raw) {
  ps_udf *u = raw;
  if (u->fn)
    napi_delete_reference(u->db->ns->env, u->fn);
  free(u);
}
static void udf_call(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argv;
  ps_udf *u = sqlite3_user_data(context);
  ps_database *d = u->db;
  napi_env e = d->ns->env;
  if (argc || !local(d->ns, e)) {
    sqlite3_result_error(context, "original UDF context required", -1);
    return;
  }
  napi_handle_scope scope;
  if (napi_open_handle_scope(e, &scope) != napi_ok) {
    sqlite3_result_error_nomem(context);
    return;
  }
  napi_value fn, result;
  int ok = napi_get_reference_value(e, u->fn, &fn) == napi_ok &&
           napi_call_function(e, undef(e), fn, 0, NULL, &result) == napi_ok;
  if (!ok) {
    remember_throw(d);
    sqlite3_result_error(context, "original UDF exception", -1);
  } else {
    napi_valuetype type;
    napi_typeof(e, result, &type);
    switch (type) {
    case napi_undefined:
    case napi_null:
      sqlite3_result_null(context);
      break;
    case napi_number: {
      double n;
      napi_get_value_double(e, result, &n);
      if (!isfinite(n) || (floor(n) == n && fabs(n) > 9007199254740991.0)) {
        fail(e, "ERR_OUT_OF_RANGE", "UDF number");
        ok = 0;
      } else if (floor(n) == n && !(n == 0 && signbit(n)))
        sqlite3_result_int64(context, (sqlite3_int64)n);
      else
        sqlite3_result_double(context, n);
      break;
    }
    case napi_bigint: {
      int64_t n;
      bool lossless = false;
      napi_get_value_bigint_int64(e, result, &n, &lossless);
      if (!lossless) {
        fail(e, "ERR_OUT_OF_RANGE", "UDF bigint");
        ok = 0;
      } else
        sqlite3_result_int64(context, n);
      break;
    }
    case napi_string: {
      char *p;
      size_t n;
      if (!string_value(e, result, &p, &n, 1)) {
        ok = 0;
        break;
      }
      sqlite3_result_text(context, p, (int)n, SQLITE_TRANSIENT);
      free(p);
      break;
    }
    case napi_object: {
      void *p;
      size_t n;
      if (!binary(e, result, &p, &n)) {
        ok = 0;
        break;
      }
      sqlite3_result_blob(context, p ? p : "", (int)n, SQLITE_TRANSIENT);
      break;
    }
    default:
      ok = 0;
      break;
    }
    if (!ok) {
      bool pending = false;
      napi_is_exception_pending(e, &pending);
      if (!pending)
        fail(e, "ERR_INVALID_ARG_TYPE", "UDF must return a synchronous SQLite scalar");
      remember_throw(d);
      sqlite3_result_error(context, "original UDF result rejected", -1);
    }
  }
  napi_close_handle_scope(e, scope);
}
static napi_value register_function(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_database *d = database_call(e, &c);
  if (!d) {
    free(c.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original database required");
  }
  char *name = NULL;
  bool deterministic = false;
  napi_valuetype a, b;
  int good = c.argc == 3 && string_value(e, c.argv[0], &name, NULL, 0) &&
             napi_typeof(e, c.argv[1], &a) == napi_ok && a == napi_boolean &&
             napi_get_value_bool(e, c.argv[1], &deterministic) == napi_ok &&
             napi_typeof(e, c.argv[2], &b) == napi_ok && b == napi_function;
  if (!good) {
    free(name);
    free(c.argv);
    return fail(e, "ERR_INVALID_ARG_TYPE", "original scalar UDF arguments required");
  }
  if (!enter(d)) {
    free(name);
    free(c.argv);
    return NULL;
  }
  ps_udf *u = calloc(1, sizeof(*u));
  if (!u) {
    d->busy = 0;
    free(name);
    free(c.argv);
    return fail(e, "ERR_MEMORY_ALLOCATION_FAILED", "UDF custody");
  }
  u->db = d;
  if (napi_create_reference(e, c.argv[2], 1, &u->fn) != napi_ok) {
    free(u);
    free(name);
    free(c.argv);
    d->busy = 0;
    return NULL;
  }
  int rc = sqlite3_create_function_v2(d->sql, name, 0,
                                      SQLITE_UTF8 | (deterministic ? SQLITE_DETERMINISTIC : 0), u,
                                      udf_call, NULL, NULL, udf_destroy);
  free(name);
  free(c.argv);
  d->busy = 0;
  if (rc != SQLITE_OK)
    return sql_error(d, rc, NULL);
  return undef(e);
}

static int method_record(napi_env e, napi_value target, const char *name, napi_value prototype,
                         const char **methods, size_t count) {
  napi_value record;
  napi_create_object(e, &record);
  for (size_t k = 0; k < count; k++) {
    napi_value fn;
    if (napi_get_named_property(e, prototype, methods[k], &fn) != napi_ok ||
        !data(e, record, methods[k], fn))
      return 0;
  }
  napi_object_freeze(e, record);
  return data(e, target, name, record);
}
napi_value ps_create_original_namespace(napi_env e, nr_root_store_io *io) {
  for (ps_namespace *n = namespaces; n; n = n->next)
    if (n->io == io)
      return fail(e, "ERR_SQLITE_ERROR", "original IO namespace is one use");
  nr_root_store_identity identity;
  if (!nr_root_store_read_identity(io, &identity) ||
      (identity.birth_state != NR_CLAIMED && identity.birth_state != NR_BOUND))
    return fail(e, "ERR_SQLITE_ERROR", "original claimed IO required");
  ps_namespace *n = calloc(1, sizeof(*n));
  if (!n)
    return fail(e, "ERR_MEMORY_ALLOCATION_FAILED", "SQLite namespace custody");
  n->env = e;
  n->pid = getpid();
  n->thread = pthread_self();
  n->io = io;
  n->next = namespaces;
  namespaces = n;
  napi_value core, dc, sc, dp, sp, fn;
  napi_create_object(e, &core);
  napi_create_reference(e, core, 1, &n->object);
  napi_property_descriptor db_methods[] = {
      {.utf8name = "exec", .method = db_exec},
      {.utf8name = "prepare", .method = db_prepare},
      {.utf8name = "registerFunction", .method = register_function},
      {.utf8name = "close", .method = db_close},
      {.utf8name = "assertDatabase", .method = assert_database}};
  napi_property_descriptor stmt_methods[] = {
      {.utf8name = "get", .method = stmt_get},
      {.utf8name = "all", .method = stmt_all},
      {.utf8name = "run", .method = stmt_run},
      {.utf8name = "setReadBigInts", .method = stmt_big},
      {.utf8name = "beginIterator", .method = stmt_iterator},
      {.utf8name = "assertStatement", .method = assert_statement}};
  for (size_t k = 0; k < 5; k++)
    db_methods[k].data = n;
  for (size_t k = 0; k < 6; k++)
    stmt_methods[k].data = n;
  if (napi_define_class(e, "OriginalProtectedDatabase", NAPI_AUTO_LENGTH, db_constructor, n, 5,
                        db_methods, &dc) != napi_ok ||
      napi_define_class(e, "OriginalProtectedStatement", NAPI_AUTO_LENGTH, stmt_constructor, n, 6,
                        stmt_methods, &sc) != napi_ok)
    return NULL;
  napi_create_reference(e, dc, 1, &n->db_ctor);
  napi_create_reference(e, sc, 1, &n->stmt_ctor);
  napi_get_named_property(e, dc, "prototype", &dp);
  napi_get_named_property(e, sc, "prototype", &sp);
  /* Instance-own getter is installed by constructor below via this descriptor. */
  napi_property_descriptor tx = {
      .utf8name = "isTransaction", .getter = transaction_state, .data = n};
  napi_define_properties(e, dp, 1, &tx);
  data(e, core, "Database", dc);
  data(e, core, "Statement", sc);
  const char *dm[] = {"exec", "prepare", "registerFunction", "close", "assertDatabase"};
  const char *sm[] = {"get", "all", "run", "setReadBigInts", "beginIterator", "assertStatement"};
  method_record(e, core, "databaseMethods", dp, dm, 5);
  method_record(e, core, "statementMethods", sp, sm, 6);
  napi_create_function(e, "transactionStateGetter", NAPI_AUTO_LENGTH, transaction_state, n, &fn);
  data(e, core, "transactionStateGetter", fn);
  napi_create_function(e, "closeOwned", NAPI_AUTO_LENGTH, ns_close, n, &fn);
  data(e, core, "closeOwned", fn);
  napi_object_freeze(e, dp);
  napi_object_freeze(e, sp);
  napi_object_freeze(e, dc);
  napi_object_freeze(e, sc);
  napi_object_freeze(e, core);
  napi_add_env_cleanup_hook(e, env_cleanup, n);
  return core;
}
napi_value ps_addon_exports(napi_env e, napi_value exports) {
  napi_property_descriptor d = {.utf8name = "assertOriginalNamespace", .method = assert_core};
  napi_define_properties(e, exports, 1, &d);
  return exports;
}
