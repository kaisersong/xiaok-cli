/* Pure ordinary component transport. Never installed or a root delegation. */
#ifndef NR_ROOT_NMP_COMPONENT
#error component_only
#endif
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <time.h>
int main(int argc,char **argv){
 if(getuid()==0||getuid()!=geteuid()||argc!=2)return 77;
 char uid[32];snprintf(uid,sizeof(uid),"%u",(unsigned)getuid());if(strcmp(uid,argv[1]))return 77;
 struct timespec birth;if(clock_gettime(CLOCK_REALTIME,&birth))return 77;
 int fd=open(NR_COMPONENT_BIRTH,O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0)return 77;
 char data[256];int n=snprintf(data,sizeof(data),"{\"pid\":%d,\"uid\":%u,\"seconds\":%lld,\"nanoseconds\":%ld}\n",getpid(),(unsigned)getuid(),(long long)birth.tv_sec,birth.tv_nsec);
 if(n<1||write(fd,data,(size_t)n)!=n||close(fd))return 77;
 char *args[]={NR_COMPONENT_NODE,NR_COMPONENT_ENTRY,NULL};
 char *env[]={"PATH=/usr/bin:/bin","ELECTRON_RUN_AS_NODE=1",NR_COMPONENT_CONFIG,NULL};
 execve(args[0],args,env);return 77;
}
