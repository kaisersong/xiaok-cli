#define _DARWIN_C_SOURCE
#include "wire.h"
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <pwd.h>
#include <grp.h>
#include <string.h>
#include <errno.h>
#include <stdlib.h>
/* Fixed launcher child, not setuid and never caller-path configurable. */
int main(int argc,char **argv){
 (void)argv;if(argc!=1)return 64;
#ifndef MI_FIXTURE_BUILD
 if(getuid()!=0||geteuid()!=0)return 77;
#endif
 struct stat st;int flags=fcntl(MI_BIRTH_FD,F_GETFL);unsigned char bytes[MI_BIRTH_BYTES];mi_birth birth;
 if(flags<0||(flags&O_ACCMODE)!=O_RDONLY||fstat(MI_BIRTH_FD,&st)||!S_ISFIFO(st.st_mode)||!mi_read_exact(MI_BIRTH_FD,bytes,sizeof(bytes),mi_now_ms()+MI_FRAME_TIMEOUT_MS)||!mi_birth_decode(bytes,&birth)||birth.helper_pid!=(uint32_t)getppid()||birth.child_pid!=(uint32_t)getpid()){mi_zero(bytes,sizeof(bytes));return 77;}
 if(close(MI_BIRTH_FD)){mi_zero(bytes,sizeof(bytes));return 77;}
 struct passwd pwd,*actual=NULL;char account[16384];if(getpwuid_r((uid_t)birth.uid,&pwd,account,sizeof(account),&actual)||!actual||pwd.pw_uid!=(uid_t)birth.uid){mi_zero(bytes,sizeof(bytes));return 77;}
 if(geteuid()==0){if(initgroups(pwd.pw_name,pwd.pw_gid)||setgid(pwd.pw_gid)||setuid(pwd.pw_uid)){mi_zero(bytes,sizeof(bytes));return 77;}}
 if(getuid()!=(uid_t)birth.uid||geteuid()!=(uid_t)birth.uid||getgid()!=pwd.pw_gid||getegid()!=pwd.pw_gid){mi_zero(bytes,sizeof(bytes));return 77;}
#ifndef MI_FIXTURE_BUILD
 if(setuid(0)==0||setgid(0)==0){mi_zero(bytes,sizeof(bytes));return 77;}
#endif
 struct rlimit limit;if(getrlimit(RLIMIT_NOFILE,&limit)||limit.rlim_cur==RLIM_INFINITY||limit.rlim_cur>1048576){mi_zero(bytes,sizeof(bytes));return 77;}
 for(int fd=3;fd<(int)limit.rlim_cur;fd++)close(fd);
 int channel[2];if(pipe(channel)){mi_zero(bytes,sizeof(bytes));return 77;}
 if(!mi_write_exact(channel[1],bytes,sizeof(bytes),mi_now_ms()+1000)){mi_zero(bytes,sizeof(bytes));close(channel[0]);close(channel[1]);return 77;}mi_zero(bytes,sizeof(bytes));mi_zero(&birth,sizeof(birth));
 if(close(channel[1])||dup2(channel[0],MI_BIRTH_FD)<0)return 77;if(channel[0]!=MI_BIRTH_FD&&close(channel[0]))return 77;
 if(fcntl(MI_BIRTH_FD,F_SETFD,0)||chdir("/"))return 77;umask(077);
 #if defined(MI_FIXTURE_BUILD) && defined(MI_FIXTURE_MAIN_ENTRY)
 char *args[]={(char*)MI_MAIN_EXEC,(char*)MI_FIXTURE_MAIN_ENTRY,NULL};
#else
 char *args[]={(char*)MI_MAIN_EXEC,NULL};
#endif
 char *environment[]={"PATH=/usr/bin:/bin","LC_ALL=C",NULL};execve(MI_MAIN_EXEC,args,environment);return errno==ENOENT?78:77;
}
