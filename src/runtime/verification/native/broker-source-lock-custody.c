/* Root broker child: permanently drop all root identities before source IO.
 * The included leaf is ordinary-user cooperative custody, not an OS sandbox. */
#ifdef XIAOK_SQLITE_CUSTODY
#define XIAOK_SQLITE_ENTRY source_lock_custody_main
#include "source-sqlite-custody.c"
#define XIAOK_SOURCE_FIELDS 9
#else
#define main source_lock_custody_main
#include "source-lock-custody.c"
#undef main
#define XIAOK_SOURCE_FIELDS 4
#endif
#include <pwd.h>
#include <grp.h>
#include "source-custody-channel.h"
#ifdef __APPLE__
#include <libproc.h>
static int close_private_fds(void){int bytes=proc_pidinfo(getpid(),PROC_PIDLISTFDS,0,NULL,0);if(bytes<=0||bytes>16*1024*1024)return 0;bytes+=4096*(int)sizeof(struct proc_fdinfo);struct proc_fdinfo *fds=malloc((size_t)bytes);if(!fds)return 0;int actual=proc_pidinfo(getpid(),PROC_PIDLISTFDS,0,fds,bytes);if(actual<=0||actual>=bytes||actual%(int)sizeof(*fds)){free(fds);return 0;}for(int i=0;i<actual/(int)sizeof(*fds);i++)if(fds[i].proc_fd>=3)close(fds[i].proc_fd);free(fds);return 1;}
#else
#include <dirent.h>
static int close_private_fds(void){DIR *directory=opendir("/proc/self/fd");if(!directory)return 0;const int own=dirfd(directory);struct dirent *entry;while((entry=readdir(directory))){unsigned long long fd;if(number(entry->d_name,&fd)&&fd>=3&&fd<=INT_MAX&&(int)fd!=own)close((int)fd);}closedir(directory);return 1;}
#endif
#ifdef XIAOK_SOURCE_CLEANUP
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
/* Derived from this already pinned helper, never a caller executable argument.
 * exec occurs only after irreversible UID/GID drop and privileged FD closure. */
static int cleanup_exec(int argc,char **argv){
 char executable[PATH_MAX],resolved[PATH_MAX],node[PATH_MAX],script[PATH_MAX];
#ifdef __APPLE__
 uint32_t size=sizeof(executable);if(_NSGetExecutablePath(executable,&size))return 77;
#else
 ssize_t size=readlink("/proc/self/exe",executable,sizeof(executable)-1);if(size<=0||(size_t)size>=sizeof(executable)-1)return 77;executable[size]=0;
#endif
 if(!realpath(executable,resolved))return 77;char *slash=strrchr(resolved,'/');if(!slash||strcmp(slash+1,"broker-source-cleanup"))return 77;*slash=0;slash=strrchr(resolved,'/');if(!slash||strcmp(slash+1,"bin"))return 77;*slash=0;
 int n=snprintf(node,sizeof(node),"%s/bin/node",resolved);if(n<0||(size_t)n>=sizeof(node))return 77;
 n=snprintf(script,sizeof(script),"%s/app/source-lock-cleanup.cjs",resolved);if(n<0||(size_t)n>=sizeof(script))return 77;
 char **args=calloc((size_t)argc+2,sizeof(char*));if(!args)return 70;args[0]=node;args[1]=script;for(int i=1;i<argc;i++)args[i+1]=argv[i];
 for(int fd=0;fd<3;fd++)if(fcntl(fd,F_SETFD,0)<0){free(args);return 77;}
 char *environment[]={"PATH=/usr/bin:/bin","ELECTRON_RUN_AS_NODE=1",NULL};execve(node,args,environment);free(args);return 77;
}
#endif
int main(int argc,char **argv){
 if(getuid()!=0||geteuid()!=0)return 77;
 unsigned long long requested;if(argc<2+XIAOK_SOURCE_FIELDS||(argc-2)%XIAOK_SOURCE_FIELDS||!number(argv[1],&requested)||requested==0||requested>UINT_MAX)return 64;
 struct passwd *record=getpwuid((uid_t)requested);if(!record||record->pw_uid!=(uid_t)requested)return 65;
 const uid_t uid=record->pw_uid;const gid_t gid=record->pw_gid;char *name=strdup(record->pw_name);if(!name)return 70;
 /* Only authenticated private stdio channels survive; no additional privileged FD does. */
 for(int fd=0;fd<3;fd++){if(!private_channel(fd,0)){free(name);return 77;}if(fcntl(fd,F_SETFD,FD_CLOEXEC)<0){free(name);return 77;}}
 if(!close_private_fds())return 77;
 if(initgroups(name,gid)||setgid(gid)||setuid(uid)){free(name);return 77;}free(name);
 if(getuid()!=uid||geteuid()!=uid||getgid()!=gid||getegid()!=gid||setuid(0)==0||setgid(0)==0)return 77;
 if(!close_private_fds())return 77;
#ifdef XIAOK_SOURCE_CLEANUP
 return cleanup_exec(argc,argv);
#else
 return source_lock_custody_main(argc,argv);
#endif
}
