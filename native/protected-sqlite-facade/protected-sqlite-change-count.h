/* Same facade TU only. No 32-bit truncation or unguarded weak API call. */
static int read_change_count(ps_database *d, sqlite3_int64 *count) {
#if defined(__APPLE__)
  if (__builtin_available(macOS 12.3, *)) {
    *count = sqlite3_changes64(d->sql);
    return 1;
  }
  d->unknown = 1;
  fail(d->ns->env, "ERR_SQLITE_API_UNAVAILABLE", "protected SQLite API unavailable");
  return 0;
#else
  *count = sqlite3_changes64(d->sql);
  return 1;
#endif
}
