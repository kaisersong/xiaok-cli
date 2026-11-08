#define _DARWIN_C_SOURCE
#include "protocol.h"
#include "enrollment-custody-channel.h"
#include <Security/Security.h>
#include <stdio.h>
#include <signal.h>
#include <sys/wait.h>
#include <pwd.h>
#include <grp.h>
#ifndef MI_CUSTODY_HELPER_EXEC
#define MI_CUSTODY_HELPER_EXEC MI_FIXED_ROOT "/main-installation-helper"
#endif
/* One original Entry owns this Native process and both actual children. It
 * does not mint approvals, Root pools or adoption claims from received FDs. */
typedef struct custody_supervisor {
 int source_channel,helper_channel,in,out,err,unknown,first_present,first_errno;
 int source_peer,source_in_read,source_out_write,source_err_write,helper_peer;
 int failed_fds[32],failed_codes[32],failed_count;
 pid_t source,helper;int source_status,helper_status,source_joined,helper_joined;
 mi_custody_birth source_birth,helper_birth;mi_custody_received received;
} custody_supervisor;
static volatile sig_atomic_t interrupted;
static void stop(int sig){(void)sig;interrupted=1;}
static int failed(custody_supervisor *s,int error){if(!s->first_present){s->first_present=1;s->first_errno=error;}s->unknown=1;return 0;}
static int close_slot(custody_supervisor *s,int *fd){
 if(*fd<0)return 1;for(int i=0;i<s->failed_count;i++)if(s->failed_fds[i]==*fd)return 0;
 int original=*fd;if(close(original)){int at=s->failed_count++;s->failed_fds[at]=original;s->failed_codes[at]=errno;return failed(s,errno);}*fd=-1;return 1;
}
static int close_except_three(void){
 int bytes=proc_pidinfo(getpid(),PROC_PIDLISTFDS,0,NULL,0);if(bytes<=0||bytes>1048576)return 0;bytes+=4096*(int)sizeof(struct proc_fdinfo);struct proc_fdinfo *fds=malloc((size_t)bytes);if(!fds)return 0;
 int actual=proc_pidinfo(getpid(),PROC_PIDLISTFDS,0,fds,bytes),good=actual>0&&actual<bytes&&actual%(int)sizeof(*fds)==0;
 if(good)for(int i=0;i<actual/(int)sizeof(*fds);i++)if(fds[i].proc_fd>3&&close(fds[i].proc_fd))good=0;
 free(fds);return good;
}
static int paths(char node[PATH_MAX],char entry[PATH_MAX]){
#ifdef MI_CUSTODY_COMPONENT_BUILD
 return snprintf(node,PATH_MAX,"%s",MI_CUSTODY_NODE)<PATH_MAX&&snprintf(entry,PATH_MAX,"%s",MI_CUSTODY_SOURCE_ENTRY)<PATH_MAX;
#else
 char current[PROC_PIDPATHINFO_MAXSIZE],resolved[PATH_MAX];if(proc_pidpath(getpid(),current,sizeof(current))<=0||!realpath(current,resolved))return 0;
 char *slash=strrchr(resolved,'/');if(!slash||strcmp(slash+1,MI_CUSTODY_PARENT_NAME))return 0;*slash=0;slash=strrchr(resolved,'/');if(!slash||strcmp(slash+1,"bin"))return 0;*slash=0;
 return snprintf(node,PATH_MAX,"%s/bin/node",resolved)<PATH_MAX&&snprintf(entry,PATH_MAX,"%s/app/root-nmp-custody.cjs",resolved)<PATH_MAX;
#endif
}
static int fill_birth(mi_custody_birth *b,pid_t child,uint32_t role,uid_t uid){
 struct proc_bsdinfo own,actual;uint64_t until=mi_cu_now()+10000;
 while(!mi_cu_proc(child,&actual)){if(mi_cu_now()>=until)return 0;struct timespec t={0,1000000};nanosleep(&t,NULL);}
 if(!mi_cu_proc(getpid(),&own)||actual.pbi_ppid!=(uint32_t)getpid())return 0;
#ifdef MI_CUSTODY_COMPONENT_BUILD
 b->kind=2;
#else
 b->kind=1;
#endif
 b->role=role;b->uid=uid;b->parent_uid=geteuid();b->parent_pid=getpid();b->child_pid=child;b->parent_sec=own.pbi_start_tvsec;b->parent_usec=own.pbi_start_tvusec;b->child_sec=actual.pbi_start_tvsec;b->child_usec=actual.pbi_start_tvusec;
 return SecRandomCopyBytes(kSecRandomDefault,32,b->nonce)==errSecSuccess;
}
static int write_birth(int fd,const mi_custody_birth *b){unsigned char bytes[112];mi_cu_encode_birth(b,bytes);return mi_cu_write(fd,bytes,sizeof(bytes));}
static int start_source(custody_supervisor *s,uid_t uid){
 int pair[2],input[2],output[2],errors[2];char node[PATH_MAX],entry[PATH_MAX];
 if(!paths(node,entry))return failed(s,errno);
 if(socketpair(AF_UNIX,SOCK_STREAM,0,pair))return failed(s,errno);s->source_channel=pair[0];s->source_peer=pair[1];
 if(pipe(input))return failed(s,errno);s->source_in_read=input[0];s->in=input[1];
 if(pipe(output))return failed(s,errno);s->out=output[0];s->source_out_write=output[1];
 if(pipe(errors))return failed(s,errno);s->err=errors[0];s->source_err_write=errors[1];
 pid_t pid=fork();
 if(!pid){
  if(dup2(input[0],0)<0||dup2(output[1],1)<0||dup2(errors[1],2)<0||dup2(pair[1],3)<0||!close_except_three()||fcntl(3,F_SETFD,0))_exit(77);
#ifndef MI_CUSTODY_COMPONENT_BUILD
  struct passwd *p=getpwuid(uid);if(!p||initgroups(p->pw_name,p->pw_gid)||setgid(p->pw_gid)||setuid(uid)||getuid()!=uid||geteuid()!=uid||setuid(0)==0||setgid(0)==0)_exit(77);
#else
  if(uid!=getuid()||getuid()!=geteuid())_exit(77);
#endif
  char *args[]={node,entry,NULL};
  char *env[]={"PATH=/usr/bin:/bin","LC_ALL=C","ELECTRON_RUN_AS_NODE=1",
#ifdef MI_CUSTODY_COMPONENT_BUILD
  MI_CUSTODY_COMPONENT_CONFIG,
#endif
  NULL};
  execve(node,args,env);_exit(77);
 }
 if(pid<0)return failed(s,errno);s->source=pid;
 int good=1;if(!close_slot(s,&s->source_peer))good=0;if(!close_slot(s,&s->source_in_read))good=0;if(!close_slot(s,&s->source_out_write))good=0;if(!close_slot(s,&s->source_err_write))good=0;
 if(!good||!fill_birth(&s->source_birth,pid,1,uid)||!write_birth(s->source_channel,&s->source_birth))return failed(s,errno);
 return 1;
}
static int start_helper(custody_supervisor *s,uid_t uid){
 int pair[2];if(socketpair(AF_UNIX,SOCK_STREAM,0,pair))return failed(s,errno);s->helper_channel=pair[0];s->helper_peer=pair[1];pid_t pid=fork();
 if(!pid){
  if(dup2(pair[1],3)<0||!close_except_three()||dup2(3,MI_CUSTODY_HELPER_FD)<0||close(3)||fcntl(MI_CUSTODY_HELPER_FD,F_SETFD,0))_exit(77);
  char *args[]={(char*)MI_CUSTODY_HELPER_EXEC,NULL};char *env[]={"PATH=/usr/bin:/bin","LC_ALL=C",NULL};execve(args[0],args,env);_exit(77);
 }
 if(pid<0)return failed(s,errno);s->helper=pid;if(!close_slot(s,&s->helper_peer))return 0;
 if(!fill_birth(&s->helper_birth,pid,2,uid)||!write_birth(s->helper_channel,&s->helper_birth))return failed(s,errno);
 return 1;
}
static int line(custody_supervisor *s,char out[8192]){
 size_t at=0;uint64_t until=mi_cu_now()+10000;
 while(at<8191){if(interrupted||!mi_cu_wait(s->out,POLLIN,until))return failed(s,errno);ssize_t n=read(s->out,out+at,1);if(n!=1)return failed(s,n<0?errno:EPIPE);if(out[at++]=='\n'){out[at]=0;return 1;}}return failed(s,EFBIG);
}
static int parent_line(custody_supervisor *s,char out[129]){
 size_t at=0;uint64_t until=0;
 while(at<128){
  if(!at){struct pollfd p={0,POLLIN,0};int n;do{n=poll(&p,1,-1);}while(n<0&&errno==EINTR&&!interrupted);if(n<1||interrupted)return failed(s,interrupted?EINTR:errno);until=mi_cu_now()+10000;}
  else if(!mi_cu_wait(0,POLLIN,until))return failed(s,errno);
  ssize_t n=read(0,out+at,1);if(n!=1)return failed(s,n<0?errno:EPIPE);if(out[at++]=='\n'){out[at]=0;return 1;}
 }return failed(s,EFBIG);
}
static int source_command(custody_supervisor *s,const char *command){return mi_cu_write(s->in,command,strlen(command))||failed(s,errno);}
static int join_child(custody_supervisor *s,pid_t child,int *status,int *joined){
 if(child<1||*joined)return *joined;uint64_t until=mi_cu_now()+10000;
 for(;;){pid_t actual=waitpid(child,status,WNOHANG);if(actual==child){*joined=1;return 1;}if(actual<0&&errno!=EINTR)return failed(s,errno);if(mi_cu_now()>=until){failed(s,ETIMEDOUT);kill(child,SIGKILL);do{actual=waitpid(child,status,0);}while(actual<0&&errno==EINTR);if(actual==child)*joined=1;return 0;}struct timespec t={0,1000000};nanosleep(&t,NULL);}
}
static int expected_ack(custody_supervisor *s,int fd,const char magic[8],const unsigned char nonce[32]){
 unsigned char ack[40];if(!mi_cu_read(fd,ack,sizeof(ack)))return failed(s,errno);
 if(memcmp(ack,magic,8)||memcmp(ack+8,nonce,32))return failed(s,EPROTO);return 1;
}
static int close_helper(custody_supervisor *s){
 if(s->helper<1||s->helper_joined)return 1;unsigned char command[40];memcpy(command,"XMCLOSE1",8);memcpy(command+8,s->helper_birth.nonce,32);
 int good=mi_cu_write(s->helper_channel,command,sizeof(command));if(!good)failed(s,errno);else good=expected_ack(s,s->helper_channel,"XMCLOSEK",s->helper_birth.nonce);
 if(!join_child(s,s->helper,&s->helper_status,&s->helper_joined))good=0;
 if(!s->helper_joined||!WIFEXITED(s->helper_status)||WEXITSTATUS(s->helper_status))good=failed(s,EIO);
 return good;
}
static void cleanup(custody_supervisor *s){
 if(s->source>0&&!s->source_joined){source_command(s,"CLOSE\n");if(s->unknown)close_slot(s,&s->source_channel);join_child(s,s->source,&s->source_status,&s->source_joined);if(!s->source_joined||!WIFEXITED(s->source_status)||WEXITSTATUS(s->source_status))failed(s,EIO);}
 close_helper(s);if(!mi_cu_close(&s->received))failed(s,s->received.first_errno);
 close_slot(s,&s->source_channel);close_slot(s,&s->helper_channel);close_slot(s,&s->in);close_slot(s,&s->out);close_slot(s,&s->err);
 close_slot(s,&s->source_peer);close_slot(s,&s->source_in_read);close_slot(s,&s->source_out_write);close_slot(s,&s->source_err_write);close_slot(s,&s->helper_peer);
}
int main(int argc,char **argv){
 signal(SIGPIPE,SIG_IGN);signal(SIGTERM,stop);signal(SIGINT,stop);if(argc!=2)return 64;
 char *end=NULL;errno=0;unsigned long uid=strtoul(argv[1],&end,10);if(errno||!end||*end||!uid||uid>UINT32_MAX)return 64;
#ifdef MI_CUSTODY_COMPONENT_BUILD
 if(getuid()==0||getuid()!=geteuid()||uid!=getuid())return 77;
#else
 if(getuid()!=0||geteuid()!=0)return 77;
#endif
 custody_supervisor s;memset(&s,0,sizeof(s));s.source_channel=s.helper_channel=s.in=s.out=s.err=s.source_peer=s.source_in_read=s.source_out_write=s.source_err_write=s.helper_peer=-1;mi_cu_init(&s.received);char source_line[8192];
 int good=start_source(&s,(uid_t)uid)&&line(&s,source_line)&&strstr(source_line,"\"state\":\"held\"");
 int requested_transfer=0;
 if(good){printf("{\"state\":\"native-born\",\"pid\":%d,\"sourcePid\":%d,\"uid\":%lu}\n",getpid(),s.source,uid);fputs(source_line,stdout);fflush(stdout);}
 while(good&&!requested_transfer){
  char command[129];if(!parent_line(&s,command)){good=0;break;}
  if(!strcmp(command,"CLOSE\n")||!strcmp(command,"STOP\n"))break;
  if(!strcmp(command,"TRANSFER\n")){requested_transfer=1;good=source_command(&s,command)&&mi_cu_receive_fds(s.source_channel,&s.source_birth,&s.received)&&start_helper(&s,(uid_t)uid);break;}
  if(strcmp(command,"CHECK\n")&&strncmp(command,"PAGE ",5)){good=failed(&s,EPROTO);break;}
  good=source_command(&s,command)&&line(&s,source_line);if(good){fputs(source_line,stdout);fflush(stdout);}
 }
 if(good&&requested_transfer){
  int fds[]={s.received.fds[0],s.received.fds[1],s.received.fds[2]};unsigned char ack[40];
  mi_custody_birth forwarded=s.helper_birth;
#if defined(MI_CUSTODY_COMPONENT_BUILD) && defined(MI_CUSTODY_COMPONENT_BAD_NONCE)
  forwarded.nonce[0]^=1;
#endif
#if defined(MI_CUSTODY_COMPONENT_BUILD) && defined(MI_CUSTODY_COMPONENT_WRONG_FILE)
  fds[1]=fds[0];
#endif
  good=mi_cu_send_fds(s.helper_channel,&forwarded,fds,s.received.ledger_digest,s.received.pool_id)&&expected_ack(&s,s.helper_channel,"XMFDACK1",s.helper_birth.nonce);
  if(good){memcpy(ack,"XMFDACK1",8);memcpy(ack+8,s.source_birth.nonce,32);good=mi_cu_write(s.source_channel,ack,sizeof(ack))&&line(&s,source_line)&&!strcmp(source_line,"{\"state\":\"transferred\"}\n")&&source_command(&s,"CLOSE\n")&&line(&s,source_line)&&!strcmp(source_line,"{\"state\":\"closed\"}\n")&&join_child(&s,s.source,&s.source_status,&s.source_joined)&&WIFEXITED(s.source_status)&&!WEXITSTATUS(s.source_status)&&mi_cu_close(&s.received);}
 }
 if(good&&requested_transfer){
  printf("{\"event\":\"custody-ready\",\"pid\":%d,\"sourcePid\":%d,\"helperPid\":%d,\"sourceClosed\":true,\"helperHeld\":true,\"scope\":\"physical-custody-only\"}\n",getpid(),s.source,s.helper);fflush(stdout);
  for(;;){char command[129];if(!parent_line(&s,command)){good=0;break;}if(!strcmp(command,"STOP\n")||!strcmp(command,"CLOSE\n"))break;
   if(strcmp(command,"CHECK\n")){good=failed(&s,EPROTO);break;}
   unsigned char check[40],ack[40];memcpy(check,"XMCHECK1",8);memcpy(check+8,s.helper_birth.nonce,32);
   if(!mi_cu_write(s.helper_channel,check,sizeof(check))||!mi_cu_read(s.helper_channel,ack,sizeof(ack))){good=failed(&s,errno);break;}
   if(memcmp(ack,"XMCURR01",8)||memcmp(ack+8,s.helper_birth.nonce,32)){good=failed(&s,EPROTO);break;}
   fputs("{\"state\":\"current\"}\n",stdout);fflush(stdout);
  }
 }
 if(!good&&!s.first_present)failed(&s,s.received.first_error_present?s.received.first_errno:(errno?errno:EPROTO));cleanup(&s);
 printf("{\"event\":\"custody-end\",\"pid\":%d,\"sourcePid\":%d,\"helperPid\":%d,\"sourceStatus\":%d,\"helperStatus\":%d,\"unknown\":%s,\"errorPresent\":%s,\"firstErrno\":%d}\n",getpid(),s.source,s.helper,s.source_status,s.helper_status,s.unknown?"true":"false",s.first_present?"true":"false",s.first_errno);return good&&!s.unknown?0:79;
}
