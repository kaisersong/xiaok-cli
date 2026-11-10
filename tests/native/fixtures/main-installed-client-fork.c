#define _DARWIN_C_SOURCE
#include "installed-main-client.h"
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
#include <errno.h>
typedef struct child_result {
  int connect,current,ping,close,fate_read,after_release;
  nm_installed_fate fate;
} child_result;
int main(void){
  nm_installed_client *client=nm_installed_create();
  if(!client||!nm_installed_connect(client)||!nm_installed_ping(client))return 81;
  nm_installed_fate before={0},after={0};
  if(!nm_installed_fate_read(client,&before))return 82;
  int pipes[2];if(pipe(pipes))return 83;
  pid_t child=fork();
  if(child<0)return 84;
  if(!child){
    close(pipes[0]);
    child_result result={0};
    result.connect=nm_installed_connect(client);
    result.current=nm_installed_current(client);
    result.ping=nm_installed_ping(client);
    result.close=nm_installed_close_owned(client);
    result.fate_read=nm_installed_fate_read(client,&result.fate);
    nm_installed_release(client);
    result.after_release=nm_installed_fate_read(client,&result.fate);
    ssize_t written=write(pipes[1],&result,sizeof(result));
    int closed=close(pipes[1]);
    _exit(written==(ssize_t)sizeof(result)&&closed==0?0:85);
  }
  close(pipes[1]);
  child_result result={0};size_t read_bytes=0;
  while(read_bytes<sizeof(result)){
    ssize_t n=read(pipes[0],((char*)&result)+read_bytes,sizeof(result)-read_bytes);
    if(n>0)read_bytes+=(size_t)n;
    else if(n<0&&errno==EINTR)continue;
    else break;
  }
  close(pipes[0]);
  int status=0;pid_t waited;do{waited=waitpid(child,&status,0);}while(waited<0&&errno==EINTR);
  int parent_ping=nm_installed_ping(client);
  int parent_close=nm_installed_close_owned(client);
  if(!nm_installed_fate_read(client,&after))return 86;
  printf("{\"kind\":\"original-client-fork\",\"pid\":%ld,\"forkPid\":%ld,\"forkReaped\":%s,\"forkStatus\":%d,"
    "\"childConnect\":%d,\"childCurrent\":%d,\"childPing\":%d,\"childClose\":%d,\"childFateRead\":%d,\"childAfterRelease\":%d,\"childUnknown\":%d,\"childRootFilesClosed\":%d,"
    "\"parentPing\":%d,\"parentClose\":%d,\"parentUnknown\":%d,\"parentRootFilesClosed\":%d,"
    "\"beforeRootSeq\":%llu,\"afterRootSeq\":%llu,\"beforeDispatchSeq\":%llu,\"afterDispatchSeq\":%llu}\n",
    (long)getpid(),(long)child,waited==child?"true":"false",status,
    result.connect,result.current,result.ping,result.close,result.fate_read,result.after_release,result.fate.unknown,result.fate.root_files_closed,
    parent_ping,parent_close,after.unknown,after.root_files_closed,
    (unsigned long long)before.root_sequence,(unsigned long long)after.root_sequence,
    (unsigned long long)before.dispatch_sequence,(unsigned long long)after.dispatch_sequence);
  nm_installed_release(client);
  return read_bytes==sizeof(result)&&waited==child&&WIFEXITED(status)&&WEXITSTATUS(status)==0?0:87;
}
