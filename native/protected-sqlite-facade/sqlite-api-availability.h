#ifndef XIAOK_SQLITE_API_AVAILABILITY_H
#define XIAOK_SQLITE_API_AVAILABILITY_H
/* Platform fact only, never an IO role or caller-supplied qualification. */
static inline int ps_sqlite_api_available(void) {
#if defined(__APPLE__)
  if (__builtin_available(macOS 12.3, *))
    return 1;
  return 0;
#else
  return 1;
#endif
}
#endif
