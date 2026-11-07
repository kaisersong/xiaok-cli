static napi_value undef(napi_env e) {
  napi_value v = NULL;
  napi_get_undefined(e, &v);
  return v;
}
static napi_value null_value(napi_env e) {
  napi_value v = NULL;
  napi_get_null(e, &v);
  return v;
}
static int data(napi_env e, napi_value o, const char *k, napi_value v) {
  napi_property_descriptor d = {
      .utf8name = k, .value = v, .attributes = napi_enumerable | napi_writable | napi_configurable};
  return napi_define_properties(e, o, 1, &d) == napi_ok;
}
static napi_value fail(napi_env e, const char *code, const char *message) {
  bool pending = false;
  napi_is_exception_pending(e, &pending);
  if (!pending)
    napi_throw_error(e, code, message);
  return NULL;
}
static int same(napi_env e, napi_ref ref, napi_value candidate) {
  napi_value v = NULL;
  bool yes = false;
  return ref && napi_get_reference_value(e, ref, &v) == napi_ok && v &&
         napi_strict_equals(e, v, candidate, &yes) == napi_ok && yes;
}
static int local(ps_namespace *n, napi_env e) {
  return n->env == e && n->pid == getpid() && pthread_equal(n->thread, pthread_self()) &&
         !n->teardown;
}
static ps_namespace *namespace_member(napi_env e, napi_value v) {
  for (ps_namespace *n = namespaces; n; n = n->next)
    if (local(n, e) && same(e, n->object, v))
      return n;
  return NULL;
}
static ps_database *database_member(napi_env e, napi_value v) {
  for (ps_namespace *n = namespaces; n; n = n->next)
    if (local(n, e) && n->db && same(e, n->db->object, v))
      return n->db;
  return NULL;
}
static ps_statement *statement_member(napi_env e, napi_value v) {
  for (ps_namespace *n = namespaces; n; n = n->next)
    if (local(n, e) && n->db)
      for (ps_statement *s = n->db->statements; s; s = s->next)
        if (same(e, s->object, v))
          return s;
  return NULL;
}
static ps_cursor *cursor_member(napi_env e, napi_value v) {
  for (ps_namespace *n = namespaces; n; n = n->next)
    if (local(n, e) && n->db)
      for (ps_cursor *c = n->db->cursors; c; c = c->next)
        if (same(e, c->object, v))
          return c;
  return NULL;
}
typedef struct {
  napi_value self, *argv;
  size_t argc;
  void *context;
} call;
static int arguments(napi_env e, napi_callback_info i, call *c) {
  memset(c, 0, sizeof(*c));
  if (napi_get_cb_info(e, i, &c->argc, NULL, &c->self, &c->context) != napi_ok)
    return 0;
  if (c->argc > 32766) {
    fail(e, "ERR_OUT_OF_RANGE", "too many SQLite arguments");
    return 0;
  }
  if (c->argc) {
    c->argv = calloc(c->argc, sizeof(napi_value));
    if (!c->argv) {
      fail(e, "ERR_MEMORY_ALLOCATION_FAILED", "SQLite arguments");
      return 0;
    }
    size_t n = c->argc;
    if (napi_get_cb_info(e, i, &n, c->argv, &c->self, &c->context) != napi_ok) {
      free(c->argv);
      return 0;
    }
  }
  return 1;
}
static ps_database *database_call(napi_env e, call *c) {
  ps_database *d = database_member(e, c->self);
  return d && c->context == d->ns ? d : NULL;
}
static ps_statement *statement_call(napi_env e, call *c) {
  ps_statement *s = statement_member(e, c->self);
  return s && c->context == s->db->ns ? s : NULL;
}
static int string_value(napi_env e, napi_value v, char **out, size_t *size, int allow_nul) {
  napi_valuetype t;
  if (napi_typeof(e, v, &t) != napi_ok || t != napi_string)
    return 0;
  size_t n;
  if (napi_get_value_string_utf8(e, v, NULL, 0, &n) != napi_ok || n > INT_MAX)
    return 0;
  char *p = malloc(n + 1);
  if (!p)
    return 0;
  size_t actual;
  if (napi_get_value_string_utf8(e, v, p, n + 1, &actual) != napi_ok || actual != n ||
      (!allow_nul && memchr(p, 0, n))) {
    free(p);
    return 0;
  }
  *out = p;
  if (size)
    *size = n;
  return 1;
}
static int remember_throw(ps_database *d) {
  napi_env e = d->ns->env;
  bool pending = false;
  if (napi_is_exception_pending(e, &pending) != napi_ok || !pending)
    return 0;
  napi_value value, box;
  if (napi_get_and_clear_last_exception(e, &value) != napi_ok)
    return 0;
  if (d->thrown_present)
    return 1;
  if (napi_create_object(e, &box) != napi_ok || !data(e, box, "value", value) ||
      napi_create_reference(e, box, 1, &d->thrown) != napi_ok) {
    d->unknown = 1;
    return 0;
  }
  d->thrown_present = 1;
  return 1;
}
static int throw_original(ps_database *d) {
  if (!d->thrown_present)
    return 0;
  napi_env e = d->ns->env;
  napi_value box, value;
  int good = napi_get_reference_value(e, d->thrown, &box) == napi_ok &&
             napi_get_named_property(e, box, "value", &value) == napi_ok;
  napi_delete_reference(e, d->thrown);
  d->thrown = NULL;
  d->thrown_present = 0;
  if (good)
    napi_throw(e, value);
  else
    fail(e, "ERR_SQLITE_ERROR", "original callback exception unavailable");
  return 1;
}
static napi_value sql_error(ps_database *d, int rc, const char *override) {
  napi_env e = d->ns->env;
  if (throw_original(d))
    return NULL;
  const char *message =
      override ? override : (d->sql ? sqlite3_errmsg(d->sql) : sqlite3_errstr(rc));
  if (!message || strstr(message, "original-root-store:") ||
      strstr(message, "original-root-io-v2-"))
    message = sqlite3_errstr(rc);
  napi_value msg, code, error, num, text;
  napi_create_string_utf8(e, message, NAPI_AUTO_LENGTH, &msg);
  napi_create_string_utf8(e, "ERR_SQLITE_ERROR", NAPI_AUTO_LENGTH, &code);
  if (napi_create_error(e, code, msg, &error) != napi_ok)
    return NULL;
  napi_create_int32(e, rc, &num);
  data(e, error, "errcode", num);
  napi_create_string_utf8(e, sqlite3_errstr(rc), NAPI_AUTO_LENGTH, &text);
  data(e, error, "errstr", text);
  napi_throw(e, error);
  return NULL;
}
static int enter(ps_database *d) {
  if (!d || !d->sql || d->closed || d->sealed || d->busy || d->unknown) {
    if (d)
      sql_error(d, SQLITE_MISUSE, "protected SQLite database unavailable or busy");
    return 0;
  }
  d->busy = 1;
  nr_root_store_identity identity;
  if (!nr_root_store_read_identity(d->ns->io, &identity)) {
    d->busy = 0;
    d->unknown = 1;
    sql_error(d, SQLITE_IOERR, "original SQLite IO current unconfirmed");
    return 0;
  }
  return 1;
}
static void finalize_statement(ps_statement *s) {
  if (s->sql) { /* finalize destroys the resource even when it repeats a step error. */
    (void)sqlite3_finalize(s->sql);
    s->sql = NULL;
  }
  s->active = 0;
}
static void statement_gc(napi_env e, void *raw, void *hint) {
  (void)hint;
  ps_statement *s = raw;
  ps_database *d = s->db;
  finalize_statement(s);
  ps_statement **p = &d->statements;
  while (*p && *p != s)
    p = &(*p)->next;
  if (*p)
    *p = s->next;
  if (s->object)
    napi_delete_reference(e, s->object);
  free(s);
}
static void close_cursor(ps_cursor *c) {
  if (c->closed)
    return;
  c->closed = 1;
  if (c->stmt->sql)
    (void)sqlite3_reset(c->stmt->sql);
  c->stmt->active = 0;
  c->stmt = NULL;
  if (c->held_stmt) {
    napi_delete_reference(c->db->ns->env, c->held_stmt);
    c->held_stmt = NULL;
  }
}
static void cursor_gc(napi_env e, void *raw, void *hint) {
  (void)hint;
  ps_cursor *c = raw;
  ps_database *d = c->db;
  close_cursor(c);
  ps_cursor **p = &d->cursors;
  while (*p && *p != c)
    p = &(*p)->next;
  if (*p)
    *p = c->next;
  if (c->object)
    napi_delete_reference(e, c->object);
  free(c);
}
static enum nr_root_release_result close_database(ps_database *d, int teardown) {
  if (d->closed)
    return NR_SQL_FILES_CLOSED;
  d->sealed = 1;
  if (d->busy)
    return NR_BUSY_HELD;
  for (ps_cursor *c = d->cursors; c; c = c->next) {
    if (!c->closed && !teardown)
      return NR_BUSY_HELD;
    if (teardown)
      close_cursor(c);
  }
  for (ps_statement *s = d->statements; s; s = s->next)
    finalize_statement(s);
  if (!d->family) {
    d->unknown = 1;
    return NR_UNKNOWN_HELD;
  }
  enum nr_root_release_result result = nr_original_root_vfs_close(d->family, &d->sql);
  if (result == NR_SQL_FILES_CLOSED && !d->unknown) {
    d->closed = 1;
    return result;
  }
  return result == NR_BUSY_HELD ? result : NR_UNKNOWN_HELD;
}
static enum nr_root_release_result close_namespace(ps_namespace *n, int teardown) {
  if (n->closed)
    return NR_SQL_FILES_CLOSED;
  enum nr_root_release_result r =
      n->db ? close_database(n->db, teardown) : nr_root_store_release_owned(n->io);
  if (r == NR_SQL_FILES_CLOSED)
    n->closed = 1;
  return r;
}
static void env_cleanup(void *raw) {
  ps_namespace *n = raw;
  (void)close_namespace(n, 1);
  n->teardown = 1; /* Producer owns held IO if teardown could not close it. */
}
static int authorize(void *raw, int action, const char *a, const char *b, const char *c,
                     const char *d) {
  (void)raw;
  (void)c;
  (void)d;
  if (action == SQLITE_ATTACH || action == SQLITE_DETACH || action == SQLITE_CREATE_VTABLE ||
      action == SQLITE_DROP_VTABLE)
    return SQLITE_DENY;
  if (action == SQLITE_PRAGMA && a) {
    if (!sqlite3_stricmp(a, "writable_schema"))
      return SQLITE_DENY;
    if (!sqlite3_stricmp(a, "journal_mode") && b && sqlite3_stricmp(b, "delete"))
      return SQLITE_DENY;
    if (!sqlite3_stricmp(a, "temp_store") && b && sqlite3_stricmp(b, "memory") && strcmp(b, "2"))
      return SQLITE_DENY;
    if (!sqlite3_stricmp(a, "mmap_size") && b && strcmp(b, "0"))
      return SQLITE_DENY;
  }
  if (action == SQLITE_FUNCTION && b && !sqlite3_stricmp(b, "load_extension"))
    return SQLITE_DENY;
  return SQLITE_OK;
}

static napi_value db_constructor(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_namespace *n = c.context;
  napi_value target = NULL;
  napi_get_new_target(e, i, &target);
  if (!n || !local(n, e) || !target || c.argc || n->entered || n->closed) {
    free(c.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original database constructor required once");
  }
  free(c.argv);
  n->entered = 1;
  ps_database *d = calloc(1, sizeof(*d));
  if (!d)
    return fail(e, "ERR_MEMORY_ALLOCATION_FAILED", "SQLite database custody");
  d->ns = n;
  n->db = d;
  if (napi_create_reference(e, c.self, 1, &d->object) != napi_ok)
    return NULL;
  int rc = nr_original_root_vfs_create(n->io, &d->family);
  if (rc == SQLITE_OK)
    rc = nr_original_root_vfs_open(d->family, &d->sql);
  if (rc != SQLITE_OK) {
    d->unknown = 1;
    return sql_error(d, rc, NULL);
  }
  sqlite3_extended_result_codes(d->sql, 1);
  sqlite3_db_config(d->sql, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
  sqlite3_set_authorizer(d->sql, authorize, d);
  return c.self;
}
static napi_value stmt_constructor(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_namespace *n = c.context;
  ps_statement *s = n ? n->creating : NULL;
  free(c.argv);
  if (!n || !local(n, e) || !s || s->object)
    return fail(e, "ERR_SQLITE_ERROR", "only original prepare creates a statement");
  if (napi_create_reference(e, c.self, 0, &s->object) != napi_ok ||
      napi_add_finalizer(e, c.self, s, statement_gc, NULL, NULL) != napi_ok)
    return NULL;
  return c.self;
}
static napi_value assert_core(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  int good = c.argc == 1 && namespace_member(e, c.argv[0]);
  free(c.argv);
  return good ? undef(e) : fail(e, "ERR_SQLITE_ERROR", "original namespace required");
}
static napi_value assert_database(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_database *d = database_call(e, &c);
  free(c.argv);
  return d ? undef(e) : fail(e, "ERR_SQLITE_ERROR", "original database required");
}
static napi_value assert_statement(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_statement *s = statement_call(e, &c);
  free(c.argv);
  return s ? undef(e) : fail(e, "ERR_SQLITE_ERROR", "original statement required");
}
static napi_value transaction_state(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_database *d = database_call(e, &c);
  free(c.argv);
  if (!d || !d->sql || d->closed)
    return fail(e, "ERR_SQLITE_ERROR", "original open database required");
  napi_value v;
  napi_get_boolean(e, !sqlite3_get_autocommit(d->sql), &v);
  return v;
}
static napi_value db_close(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_database *d = database_call(e, &c);
  free(c.argv);
  if (!d)
    return fail(e, "ERR_SQLITE_ERROR", "original database required");
  enum nr_root_release_result r = close_database(d, 0);
  return r == NR_SQL_FILES_CLOSED ? undef(e)
                                  : sql_error(d, r == NR_BUSY_HELD ? SQLITE_BUSY : SQLITE_IOERR,
                                              "protected SQLite close held");
}
static napi_value ns_close(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_namespace *n = namespace_member(e, c.self);
  free(c.argv);
  if (!n || c.context != n)
    return fail(e, "ERR_SQLITE_ERROR", "original namespace required");
  enum nr_root_release_result r = close_namespace(n, 0);
  return r == NR_SQL_FILES_CLOSED
             ? undef(e)
             : fail(e, "ERR_SQLITE_ERROR", "protected SQLite namespace close held");
}
static napi_value db_exec(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_database *d = database_call(e, &c);
  if (!d) {
    free(c.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original database required");
  }
  char *sql = NULL;
  if (c.argc != 1 || !string_value(e, c.argv[0], &sql, NULL, 0)) {
    free(c.argv);
    return fail(e, "ERR_INVALID_ARG_TYPE", "SQL must be a primitive string");
  }
  free(c.argv);
  if (!enter(d)) {
    free(sql);
    return NULL;
  }
  int rc = sqlite3_exec(d->sql, sql, NULL, NULL, NULL);
  free(sql);
  d->busy = 0;
  if (rc != SQLITE_OK || d->thrown_present)
    return sql_error(d, rc, NULL);
  return undef(e);
}
static napi_value db_prepare(napi_env e, napi_callback_info i) {
  call c;
  if (!arguments(e, i, &c))
    return NULL;
  ps_database *d = database_call(e, &c);
  if (!d) {
    free(c.argv);
    return fail(e, "ERR_SQLITE_ERROR", "original database required");
  }
  char *sql = NULL;
  size_t length = 0;
  if (c.argc != 1 || !string_value(e, c.argv[0], &sql, &length, 0)) {
    free(c.argv);
    return fail(e, "ERR_INVALID_ARG_TYPE", "SQL must be a primitive string");
  }
  free(c.argv);
  if (!enter(d)) {
    free(sql);
    return NULL;
  }
  sqlite3_stmt *prepared = NULL;
  const char *tail = NULL;
  int rc = sqlite3_prepare_v2(d->sql, sql, (int)length, &prepared, &tail);
  int extra = 0;
  if (rc == SQLITE_OK && tail) {
    for (const char *p = tail; *p; p++)
      if (*p != ' ' && *p != '\n' && *p != '\r' && *p != '\t' && *p != ';')
        extra = 1;
  }
  free(sql);
  d->busy = 0;
  if (rc != SQLITE_OK || !prepared || extra) {
    if (prepared)
      sqlite3_finalize(prepared);
    return sql_error(d, rc == SQLITE_OK ? SQLITE_MISUSE : rc,
                     extra ? "only one prepared statement is supported" : NULL);
  }
  ps_statement *s = calloc(1, sizeof(*s));
  if (!s) {
    sqlite3_finalize(prepared);
    return fail(e, "ERR_MEMORY_ALLOCATION_FAILED", "SQLite statement custody");
  }
  s->db = d;
  s->sql = prepared;
  s->next = d->statements;
  d->statements = s;
  napi_value ctor, value = NULL;
  napi_get_reference_value(e, d->ns->stmt_ctor, &ctor);
  d->ns->creating = s;
  napi_status status = napi_new_instance(e, ctor, 0, NULL, &value);
  d->ns->creating = NULL;
  if (status != napi_ok)
    return NULL;
  return value;
}

static int binary(napi_env e, napi_value value, void **bytes, size_t *size) {
  bool yes = false;
  napi_is_typedarray(e, value, &yes);
  if (yes) {
    napi_typedarray_type type;
    size_t n, offset;
    napi_value backing;
    if (napi_get_typedarray_info(e, value, &type, &n, bytes, &backing, &offset) != napi_ok)
      return 0;
    bool ab = false;
    napi_is_arraybuffer(e, backing, &ab);
    if (!ab)
      return 0;
    size_t width =
        type == napi_int16_array || type == napi_uint16_array                                 ? 2
        : type == napi_int32_array || type == napi_uint32_array || type == napi_float32_array ? 4
        : type == napi_float64_array || type == napi_bigint64_array || type == napi_biguint64_array
            ? 8
            : 1;
    if (n > INT_MAX / width)
      return 0;
    *size = n * width;
    return 1;
  }
  napi_is_dataview(e, value, &yes);
  if (yes) {
    napi_value backing;
    size_t offset;
    if (napi_get_dataview_info(e, value, size, bytes, &backing, &offset) != napi_ok)
      return 0;
    bool ab = false;
    napi_is_arraybuffer(e, backing, &ab);
    return ab && *size <= INT_MAX;
  }
  return 0;
}
