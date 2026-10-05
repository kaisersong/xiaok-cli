#define _DARWIN_C_SOURCE
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <unistd.h>
#include <stdio.h>

/* Descriptor 3 is duplicated by the service from its accepted AF_UNIX socket.
 * No PID, UID or claimed source is accepted from caller-controlled JSON. */
int main(void) {
  struct sockaddr_storage address; socklen_t size = sizeof(address);
  if (getpeername(3, (struct sockaddr *)&address, &size) || address.ss_family != AF_UNIX) return 65;
  uid_t uid; gid_t gid;
#if defined(__APPLE__)
  if (getpeereid(3, &uid, &gid)) return 66;
#elif defined(__linux__)
  struct ucred credentials; socklen_t length = sizeof(credentials);
  if (getsockopt(3, SOL_SOCKET, SO_PEERCRED, &credentials, &length) || length != sizeof(credentials)) return 66;
  uid = credentials.uid; gid = credentials.gid;
#else
  return 78;
#endif
  printf("{\"uid\":%llu,\"gid\":%llu}\n", (unsigned long long)uid, (unsigned long long)gid);
  return 0;
}
