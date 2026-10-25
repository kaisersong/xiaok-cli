#include <sys/socket.h>
/* Node's stdio:'pipe' uses AF_UNIX socketpairs on macOS. Accept only an
 * actual pipe or a local socket whose kernel peer has the expected UID. */
static int private_channel(int fd,uid_t expected){
 struct stat s;if(fstat(fd,&s))return 0;if(S_ISFIFO(s.st_mode))return 1;if(!S_ISSOCK(s.st_mode))return 0;
 struct sockaddr_storage address;socklen_t length=sizeof(address);if(getpeername(fd,(struct sockaddr *)&address,&length)||address.ss_family!=AF_UNIX)return 0;
#ifdef __APPLE__
 uid_t uid;gid_t gid;return !getpeereid(fd,&uid,&gid)&&uid==expected;
#elif defined(__linux__)
 struct ucred peer;length=sizeof(peer);return !getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&peer,&length)&&length==sizeof(peer)&&peer.uid==expected;
#else
 return 0;
#endif
}
