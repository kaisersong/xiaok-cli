#include "broker-protocol.h"
#define _DARWIN_C_SOURCE
#include "../main-installation/wire.h"
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <string.h>
#include <errno.h>
/* Fixed private entry: fd3 is original Node business IPC, 198 is one-use birth.
 * No executable, argv, environment identity or file family is caller input. */
int main(int argc,char **argv){
 (void)argv;if(argc!=1)return 64;unsigned char bytes[MI_BROKER_BIRTH_BYTES];mi_birth birth;struct stat st;
 int flags=fcntl(MI_BIRTH_FD,F_GETFL);
 if(flags<0||(flags&O_ACCMODE)!=O_RDONLY||fstat(MI_BIRTH_FD,&st)||!S_ISFIFO(st.st_mode)||!mi_read_exact(MI_BIRTH_FD,bytes,sizeof(bytes),mi_now_ms()+MI_FRAME_TIMEOUT_MS)||!mi_birth_decode(bytes,&birth)||birth.child_pid!=(uint32_t)getpid()||birth.uid!=(uint32_t)getuid()||getuid()!=geteuid())return 77;
 uint32_t parent=(uint32_t)bytes[88]<<24|(uint32_t)bytes[89]<<16|(uint32_t)bytes[90]<<8|bytes[91];
 if(parent!=(uint32_t)getppid()||fcntl(3,F_GETFD)<0||close(MI_BIRTH_FD)){mi_zero(bytes,sizeof(bytes));return 77;}
 struct rlimit limit;if(getrlimit(RLIMIT_NOFILE,&limit)||limit.rlim_cur==RLIM_INFINITY||limit.rlim_cur>1048576){mi_zero(bytes,sizeof(bytes));return 77;}
 for(int fd=4;fd<(int)limit.rlim_cur;fd++)close(fd);
 int channel[2];if(pipe(channel)){mi_zero(bytes,sizeof(bytes));return 77;}
 int good=mi_write_exact(channel[1],bytes,sizeof(bytes),mi_now_ms()+1000);mi_zero(bytes,sizeof(bytes));mi_zero(&birth,sizeof(birth));
 if(close(channel[1]))good=0;if(!good||dup2(channel[0],MI_BIRTH_FD)<0)return 77;if(channel[0]!=MI_BIRTH_FD&&close(channel[0]))return 77;
 if(fcntl(MI_BIRTH_FD,F_SETFD,0)||fcntl(3,F_SETFD,0)||chdir("/"))return 77;umask(077);
#if defined(MI_FIXTURE_BUILD) && defined(MI_FIXTURE_BROKER_COMPONENT)
 char *args[]={(char*)MI_BROKER_EXEC,NULL};
#else
 char *args[]={(char*)MI_BROKER_EXEC,(char*)MI_BROKER_ENTRY,NULL};
#endif
 char *environment[]={"PATH=/usr/bin:/bin","LC_ALL=C","ELECTRON_RUN_AS_NODE=1","NODE_CHANNEL_FD=3","NODE_CHANNEL_SERIALIZATION_MODE=json",NULL};
 execve(MI_BROKER_EXEC,args,environment);return errno==ENOENT?78:77;
}
