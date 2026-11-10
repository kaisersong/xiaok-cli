#define _DARWIN_C_SOURCE
#include "installed-main-client.h"
#include "wire.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* Component probe calls the original client and original wire. It neither
 * supplies a Main role nor stands in for the two-DSO Electron qualification. */
int main(int argc, char **argv) {
  if (argc != 2) return 64;
  if (close(MI_BIRTH_FD) && errno != EBADF) return 65;
  if (strcmp(argv[1], "missing")) {
    int pipes[2];
    if (pipe(pipes)) return 66;
    mi_birth birth = {0};
    birth.helper_pid = (uint32_t)getpid();
    birth.child_pid = (uint32_t)getpid();
    birth.uid = (uint32_t)getuid();
    unsigned char bytes[MI_BIRTH_BYTES + 1] = {0};
    if (!mi_random(birth.nonce, sizeof(birth.nonce)) ||
        !mi_random(birth.seed, sizeof(birth.seed)) ||
        !mi_birth_encode(&birth, bytes)) return 67;
    if (!strcmp(argv[1], "malformed")) bytes[0] ^= 1;
    size_t length = MI_BIRTH_BYTES;
    if (!strcmp(argv[1], "trailing")) length++;
    if (write(pipes[1], bytes, length) != (ssize_t)length ||
        close(pipes[1]) || dup2(pipes[0], MI_BIRTH_FD) != MI_BIRTH_FD ||
        close(pipes[0]) || fcntl(MI_BIRTH_FD, F_SETFD, 0)) return 68;
    mi_zero(bytes, sizeof(bytes));
    mi_zero(&birth, sizeof(birth));
  }
  nm_installed_client *client = nm_installed_create();
  if (!client) return 69;
  int connected = nm_installed_connect(client);
  nm_installed_fate first = {0}, last = {0};
  if (!nm_installed_fate_read(client, &first)) return 70;
  int replay = nm_installed_connect(client);
  int cleanup = nm_installed_close_owned(client);
  if (!nm_installed_fate_read(client, &last)) return 71;
  int seed_descriptor_closed = fcntl(MI_BIRTH_FD, F_GETFD) == -1 && errno == EBADF;
  printf("{\"connected\":%d,\"replay\":%d,\"cleanup\":%d,"
         "\"attempted\":%d,\"entered\":%d,\"closed\":%d,"
         "\"unknown\":%d,\"seedClosed\":%d,\"errorPresent\":%d,"
         "\"errorCode\":%d,\"seedDescriptorClosed\":%d,"
         "\"unknownRetained\":%d,\"rootFilesClosed\":%d}\n",
         connected, replay, cleanup, last.attempted, last.entered,
         last.closed, last.unknown, last.seed_closed, last.error_present,
         last.error_code, seed_descriptor_closed, first.unknown == last.unknown,
         last.root_files_closed);
  nm_installed_release(client);
  return 0;
}
