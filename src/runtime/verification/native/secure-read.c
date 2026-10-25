/* Minimal descriptor-relative reader for frozen, host-authorized material.
 * It grants no permission: the installed service invokes it only after checking
 * its grant. The executable and complete dependency closure must be protected.
 */
#define _DARWIN_C_SOURCE
#define _GNU_SOURCE
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>

static int descend(int parent, const char *path, int final_flags) {
  char *copy = strdup(path); if (!copy) return -1;
  int current = dup(parent); if (current < 0) { free(copy); return -1; }
  char *part = copy;
  for (;;) {
    char *slash = strchr(part, '/'); if (slash) *slash = 0;
    if (!*part || !strcmp(part, ".") || !strcmp(part, "..")) { close(current); free(copy); return -1; }
    int next = openat(current, part, O_NOFOLLOW | O_CLOEXEC | (slash ? O_RDONLY | O_DIRECTORY : final_flags));
    close(current); current = next;
    if (current < 0 || !slash) break;
    part = slash + 1;
  }
  free(copy); return current;
}
static int number(const char *text, unsigned long long *value) {
  if (!text || !*text || *text == '-') return 0;
  char *end; errno = 0; *value = strtoull(text, &end, 10); return !errno && !*end;
}
int main(int argc, char **argv) {
  unsigned long long limit, rootdev, rootino;
  if (argc != 6 || argv[1][0] != '/' || !number(argv[3], &limit) || limit > 16777216 || !number(argv[4], &rootdev) || !number(argv[5], &rootino)) return 64;
  int slash = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC); if (slash < 0) return 65;
  int root = argv[1][1] ? descend(slash, argv[1] + 1, O_RDONLY | O_DIRECTORY) : dup(slash); close(slash); if (root < 0) return 66;
  struct stat rootstat;
  if (fstat(root, &rootstat) || (unsigned long long)rootstat.st_dev != rootdev || (unsigned long long)rootstat.st_ino != rootino) { close(root); return 67; }
  int file = descend(root, argv[2], O_RDONLY | O_NONBLOCK); close(root); if (file < 0) return 68;
  struct stat before, after;
  if (fstat(file, &before) || !S_ISREG(before.st_mode) || before.st_nlink != 1 || before.st_size < 0 || (unsigned long long)before.st_size > limit) { close(file); return 69; }
  size_t size = (size_t)before.st_size; unsigned char *bytes = malloc(size ? size : 1); if (!bytes) { close(file); return 70; }
  size_t offset = 0;
  while (offset < size) { ssize_t n = read(file, bytes + offset, size - offset); if (n <= 0) { free(bytes); close(file); return 71; } offset += (size_t)n; }
  if (fstat(file, &after) || after.st_size != before.st_size || after.st_mode != before.st_mode || after.st_nlink != before.st_nlink || after.st_mtime != before.st_mtime || after.st_ctime != before.st_ctime) { free(bytes); close(file); return 72; }
  close(file); offset = 0;
#ifdef XIAOK_EMIT_READ_METADATA
  /* Broker-only framing: mode and bytes originate from the exact same opened
   * descriptor. No privileged path lstat is substituted for this fact. */
  const unsigned char header[2] = { (before.st_mode & 0111) ? '1' : '0', '\n' };
  if (write(STDOUT_FILENO, header, sizeof(header)) != (ssize_t)sizeof(header)) { free(bytes); return 73; }
#endif
  while (offset < size) { ssize_t n = write(STDOUT_FILENO, bytes + offset, size - offset); if (n <= 0) { free(bytes); return 73; } offset += (size_t)n; }
  free(bytes); return 0;
}
