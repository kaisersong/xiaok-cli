/* Non-setuid child of the installed root broker only. No root process opens
 * requested material: irrevocable credential drop precedes secure_reader_main. */
#define XIAOK_EMIT_READ_METADATA
#define main secure_reader_main
#include "secure-read.c"
#undef main
#include <pwd.h>
#include <grp.h>
#include <limits.h>

int main(int argc, char **argv) {
  if (getuid() != 0 || geteuid() != 0) return 77;
  unsigned long long requested;
  if (argc != 7 || !number(argv[1], &requested) || requested == 0 || requested > UINT_MAX) return 64;
  struct passwd *user = getpwuid((uid_t)requested);
  if (!user || user->pw_uid != (uid_t)requested || !strcmp(user->pw_name, "_xiaok_verifier")) return 65;
  /* Copy NSS-owned fields before initgroups can reuse its shared buffers. */
  const uid_t uid = user->pw_uid; const gid_t gid = user->pw_gid;
  char *name = strdup(user->pw_name); if (!name) return 70;
  if (initgroups(name, gid) || setgid(gid) || setuid(uid)) { free(name); return 77; }
  free(name);
  if (getuid() != uid || geteuid() != uid || getgid() != gid || getegid() != gid || setuid(0) == 0) return 77;
  char *reader_argv[] = { argv[0], argv[2], argv[3], argv[4], argv[5], argv[6], NULL };
  return secure_reader_main(6, reader_argv);
}
