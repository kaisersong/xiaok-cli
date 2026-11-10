#define _DARWIN_C_SOURCE
#include "wire.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <pwd.h>
#include <dirent.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <libproc.h>
#include <OpenDirectory/OpenDirectory.h>
#include <sys/acl.h>
#endif
#include "root-store-state.h"
#include "enrollment-custody-channel.h"
#define MAX_CHANNELS 8
/* Installation certification is root-owned input, not caller authorization.
 * This Stage1 binary never installs itself or repairs an interrupted namespace. */
typedef struct connection {
 int fd,authenticated,closing,domain,source_role;
 uint64_t next,deadline;
 size_t received,wanted,sent,reply_length;
 unsigned char key[32],input[MI_MAX_FRAME],reply[MI_MAX_FRAME];
} connection;
typedef struct state {
 int root,listener,used,unknown,child_exited,child_status,authority_sealed;
 int enrollment_control,enrollment_control_close_entered;mi_custody_birth enrollment_birth;mi_custody_received enrollment_custody;
 mi_store_lease root_store,families[MI_AUTHORITY_MAX_LEASES];
 size_t family_count;
 int failed_close_fds[16],failed_close_count;
 pid_t child;
 mi_birth birth;
 struct stat root_identity,main_identity,socket_identity;
 unsigned char release[32];
#ifdef __APPLE__
 struct proc_bsdinfo child_identity;
#endif
 struct {
 int prepared,published,used,files_closed,terminal,retired,unknown;
 mi_birth birth;mi_store_lease *lease;struct stat launcher,executable;
#ifdef __APPLE__
 struct proc_bsdinfo process;
#endif
 } ks,br;
 connection connections[MAX_CHANNELS];
} state;
static volatile sig_atomic_t stopping;
static void stop_signal(int n){(void)n;stopping=1;}
static int close_owned(int *fd){if(*fd<0)return 1;int original=*fd;*fd=-1;return close(original)==0;}
#include "installation-certificate.h"
static int closure(state *s){
#ifdef MI_FIXTURE_BUILD
 unsigned char expected[32];return hex_digest(MI_EXPECTED_MAIN_SHA256,expected)&&hash_file(MI_MAIN_EXEC,s->release,&s->main_identity)&&!memcmp(expected,s->release,32)&&s->main_identity.st_uid==getuid()&&!(s->main_identity.st_mode&0022);
#else
 /* Fixed protected installation certificate, generated only by the reviewed
  * system installer. No argv/env path, UID, public key or role is accepted. */
 if(getuid()!=0||geteuid()!=0||!mi_running_image(MI_HELPER_EXEC))return 0;
 int root=checked_chain(MI_FIXED_ROOT,1);if(root<0)return 0;
 int meta=openat(root,"installation.bin",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);unsigned char bytes[120],extra;struct stat st;int good=meta>=0&&!fstat(meta,&st)&&S_ISREG(st.st_mode)&&st.st_uid==0&&st.st_nlink==1&&(st.st_mode&077)==0&&st.st_size==(off_t)sizeof(bytes)&&safe_acl(meta);
 if(good)good=mi_read_exact(meta,bytes,sizeof(bytes),mi_now_ms()+1000)&&read(meta,&extra,1)==0;
 if(meta>=0&&close(meta))good=0;if(close(root))good=0;
 if(!good||!mi_certificate_decode(bytes,sizeof(bytes),0))return 0;
 uint32_t uid=(uint32_t)bytes[12]<<24|(uint32_t)bytes[13]<<16|(uint32_t)bytes[14]<<8|bytes[15];if(!uid||!account_generation(uid,bytes+80))return 0;
 unsigned char digest[32];unsigned char release[32];if(!hash_file(MI_MAIN_EXEC,digest,&s->main_identity)||s->main_identity.st_uid!=0||(s->main_identity.st_mode&0022)||memcmp(digest,bytes+48,32)||!signed_bundle()||!protected_launcher()||!mi_signed_installation_components()||!mi_release_digest(release,&s->main_identity,0)||memcmp(release,bytes+16,32))return 0;
 /* Original local account generation and signed fixed closure were checked.
  * The file-service birth still grants no business/installed profile. */
 memcpy(s->release,bytes+16,32);s->birth.uid=uid;mi_zero(bytes,sizeof(bytes));return 1;
#endif
}
#include "root-store-io.h"
#include "authority-family-io.h"
#include "kswarm-child-delegation.h"
#include "broker-child-delegation.h"
#include "enrollment-custody-helper.h"
static int open_namespace(state *s){return store_open_namespace(s,&s->root_store);}
static int current(state *s){
 struct stat r,a,named_authority,db,lock,main;if(lstat(MI_FIXED_ROOT,&r)||!directory_identity(&r,&s->root_identity)||fstat(s->root_store.authority,&a)||!directory_identity(&a,&s->root_store.authority_identity)||fstatat(s->root,MI_AUTHORITY_BASENAME,&named_authority,AT_SYMLINK_NOFOLLOW)||!directory_identity(&named_authority,&s->root_store.authority_identity)||fstatat(s->root_store.authority,MI_DATABASE_BASENAME,&db,AT_SYMLINK_NOFOLLOW)||!identity(&db,&s->root_store.file_identity[MI_DATABASE])||fstatat(s->root_store.authority,"issuer.lock",&lock,AT_SYMLINK_NOFOLLOW)||!identity(&lock,&s->root_store.file_identity[MI_ISSUER_LOCK])||lstat(MI_MAIN_EXEC,&main)||!identity(&main,&s->main_identity)||main.st_size!=s->main_identity.st_size||main.st_mtimespec.tv_sec!=s->main_identity.st_mtimespec.tv_sec||main.st_mtimespec.tv_nsec!=s->main_identity.st_mtimespec.tv_nsec)goto stale;
 if(!s->root_store.closed){struct stat actual;for(int i=1;i<=3;i++){if(s->root_store.files[i]<0)continue;if(fstat(s->root_store.files[i],&actual)||!identity(&actual,s->root_store.file_identity+i)||!safe_acl(s->root_store.files[i]))goto stale;}}
 if(s->unknown)return 0;if(!safe_acl(s->root)||!safe_acl(s->root_store.authority)||!store_current(s,&s->root_store))goto stale;return 1;
stale:s->unknown=1;return 0;
}
static int start_listener(state *s){
 s->listener=socket(AF_UNIX,SOCK_STREAM,0);if(s->listener<0||fcntl(s->listener,F_SETFD,FD_CLOEXEC)||fcntl(s->listener,F_SETFL,O_NONBLOCK))return 0;
 struct sockaddr_un addr;memset(&addr,0,sizeof(addr));addr.sun_family=AF_UNIX;const char path[]=MI_FIXED_ROOT "/" MI_SOCKET_BASENAME;if(sizeof(path)>sizeof(addr.sun_path))return 0;memcpy(addr.sun_path,path,sizeof(path));struct stat prior;
 if(!lstat(path,&prior)){if(!S_ISSOCK(prior.st_mode)||prior.st_uid!=getuid()||unlink(path))return 0;}else if(errno!=ENOENT)return 0;
 return !bind(s->listener,(struct sockaddr*)&addr,sizeof(addr))&&!chmod(path,0666)&&!lstat(path,&s->socket_identity)&&!listen(s->listener,8);
}
static int launch(state *s){
 int pipefd[2];if(pipe(pipefd))return 0;
 for(int i=0;i<2;i++){if(pipefd[i]==MI_BIRTH_FD){int copy=fcntl(pipefd[i],F_DUPFD_CLOEXEC,MI_BIRTH_FD+1);if(copy<0){close(pipefd[0]);close(pipefd[1]);return 0;}close(pipefd[i]);pipefd[i]=copy;}if(fcntl(pipefd[i],F_SETFD,FD_CLOEXEC)){close(pipefd[0]);close(pipefd[1]);return 0;}}
 posix_spawn_file_actions_t files;posix_spawnattr_t attr;int files_ready=posix_spawn_file_actions_init(&files)==0,attr_ready=posix_spawnattr_init(&attr)==0;int good=files_ready&&attr_ready;
 if(good)good=!posix_spawn_file_actions_adddup2(&files,pipefd[0],MI_BIRTH_FD)&&!posix_spawn_file_actions_addclose(&files,pipefd[0])&&!posix_spawn_file_actions_addclose(&files,pipefd[1]);
 char *argv[]={(char*)MI_LAUNCHER_EXEC,NULL};char *env[]={"PATH=/usr/bin:/bin","LC_ALL=C",NULL};pid_t pid=-1;int error=good?posix_spawn(&pid,MI_LAUNCHER_EXEC,&files,&attr,argv,env):EPERM;
 if(files_ready)posix_spawn_file_actions_destroy(&files);if(attr_ready)posix_spawnattr_destroy(&attr);close(pipefd[0]);if(error){close(pipefd[1]);errno=error;return 0;}
 s->child=pid;
#ifdef __APPLE__
 if(proc_pidinfo((int)pid,PROC_PIDTBSDINFO,0,&s->child_identity,sizeof(s->child_identity))!=(int)sizeof(s->child_identity)){close(pipefd[1]);return 0;}
#endif
 s->birth.helper_pid=(uint32_t)getpid();s->birth.child_pid=(uint32_t)pid;
#ifdef MI_FIXTURE_BUILD
 s->birth.uid=(uint32_t)getuid();
#endif
 unsigned char bytes[MI_BIRTH_BYTES];good=mi_random(s->birth.nonce,32)&&mi_random(s->birth.seed,32)&&mi_birth_encode(&s->birth,bytes)&&mi_write_exact(pipefd[1],bytes,sizeof(bytes),mi_now_ms()+1000);mi_zero(bytes,sizeof(bytes));if(close(pipefd[1]))good=0;
 printf("{\"event\":\"spawn\",\"pid\":%ld}\n",(long)pid);fflush(stdout);return good;
}
static int child_peer(state *s,int fd){
 uint32_t pid,uid;if(!mi_peer_identity(fd,&pid,&uid)||pid!=(uint32_t)s->child||uid!=s->birth.uid)return 0;
#ifdef __APPLE__
 char executable[PROC_PIDPATHINFO_MAXSIZE];struct proc_bsdinfo process;if(proc_pidinfo((int)pid,PROC_PIDTBSDINFO,0,&process,sizeof(process))!=(int)sizeof(process)||process.pbi_uid!=uid||process.pbi_ruid!=uid||process.pbi_start_tvsec!=s->child_identity.pbi_start_tvsec||process.pbi_start_tvusec!=s->child_identity.pbi_start_tvusec||proc_pidpath((int)pid,executable,sizeof(executable))<=0||strcmp(executable,MI_MAIN_EXEC))return 0;
#endif
 return current(s);
}
static int close_file_lease(state *s){
 if(s->root_store.closed|| (s->ks.prepared&&!s->ks.retired)||(s->br.prepared&&!s->br.retired))return 0;s->authority_sealed=1;s->root_store.closed=1;int good=1,first=0;
 for(size_t i=0;i<s->family_count;i++)if(!authority_close(s,s->families+i)){if(good)first=errno?errno:EIO;good=0;}
 for(int i=1;i<=3;i++){int original=s->root_store.files[i];if(!close_owned(s->root_store.files+i)){if(good)first=errno;good=0;if(s->failed_close_count<16)s->failed_close_fds[s->failed_close_count++]=original;}}
 if(!close_owned(&s->root_store.store.receipt_fd)){if(good)first=errno;good=0;}
 if(!good){s->unknown=1;errno=first;}return good;
}
static int io(state *s,const mi_frame *f,const unsigned char *input,mi_frame *r,unsigned char *output){if(f->operation>=MI_BROKER_PREPARE&&f->operation<=MI_BROKER_RETIRE)return br_control(s,f,input,r,output);if(f->operation>=MI_KSWARM_PREPARE&&f->operation<=MI_KSWARM_RETIRE)return ks_control(s,f,input,r,output);if(f->operation>=MI_AUTHORITY_OPEN&&f->operation<=MI_AUTHORITY_RELEASE)return authority_io(s,f,input,r,output);return store_io(s,&s->root_store,f,input,r,output);}
static int process_frame(state *s,connection *c){
 unsigned char payload[MI_MAX_PAYLOAD],output[MI_MAX_PAYLOAD];mi_frame f,r;memset(&f,0,sizeof(f));
 if(!c->authenticated){
  if(c->received<MI_HEADER_BYTES)return 0;uint8_t domain=c->input[7];mi_birth *birth=NULL;int bit=0;
  switch(c->source_role){
   case 0:if(domain!=MI_ROOT_IO&&domain!=MI_DISPATCH)return 0;bit=1<<(domain-1);if(s->used&bit)return 0;birth=&s->birth;break;
   case 1:if(domain!=MI_KSWARM_IO||s->ks.used)return 0;birth=&s->ks.birth;break;
   case 2:if(domain!=MI_BROKER_IO||s->br.used)return 0;birth=&s->br.birth;break;
   default:return 0;
  }
  unsigned char prekey[32];if(!mi_derive_key(birth,domain,prekey)||!mi_frame_decode(prekey,c->input,c->received,&f,payload,sizeof(payload))||f.operation!=MI_HELLO||f.status||f.slot||f.sequence||f.offset||f.amount||f.payload_length!=32||memcmp(f.nonce,birth->nonce,32)){mi_zero(prekey,32);return 0;}
  unsigned char reply[64];if(!mi_random(reply,32)){mi_zero(prekey,32);return 0;}memcpy(reply+32,s->release,32);r=f;r.operation|=MI_RESPONSE;r.payload_length=64;
  int good=mi_frame_encode(prekey,&r,reply,c->reply,sizeof(c->reply),&c->reply_length)&&mi_finalize_key(birth,domain,payload,reply,s->release,c->key);mi_zero(prekey,32);mi_zero(reply,64);mi_zero(payload,sizeof(payload));if(!good)return 0;

#ifdef MI_FIXTURE_BUILD
 fputs("MI_FIXTURE_HELLO_ACCEPTED\n",stderr);
#endif
 c->authenticated=1;c->domain=domain;c->next=1;if(c->source_role==1){s->ks.used=1;mi_zero(s->ks.birth.seed,32);}else if(c->source_role==2){s->br.used=1;mi_zero(s->br.birth.seed,32);}else{s->used|=bit;if(s->used==3)mi_zero(s->birth.seed,32);}return 1;
 }
 if(!mi_frame_decode(c->key,c->input,c->received,&f,payload,sizeof(payload))||f.domain!=c->domain||f.sequence!=c->next||f.sequence==UINT64_MAX||memcmp(f.nonce,c->source_role==2?s->br.birth.nonce:c->source_role==1?s->ks.birth.nonce:s->birth.nonce,32)||(f.operation!=MI_CLOSE&&f.operation!=MI_KSWARM_RETIRE&&f.operation!=MI_BROKER_RETIRE&&f.operation!=MI_JOURNAL_CLOSE&&f.operation!=MI_AUTHORITY_RELEASE&&!(f.operation==MI_AUTHORITY_REQUEST&&f.payload_length>=52&&payload[32]==0&&payload[33]==MI_JOURNAL_CLOSE)&&!current(s)))return 0;
 r=f;r.operation|=MI_RESPONSE;r.payload_length=0;r.amount=0;r.status=0;
 if(c->source_role==1?!ks_io(s,&f,payload,&r,output):c->source_role==2?!br_io(s,&f,payload,&r,output):!io(s,&f,payload,&r,output))return 0;c->next++;
 if(!mi_frame_encode(c->key,&r,output,c->reply,sizeof(c->reply),&c->reply_length))return 0;
 if(f.operation==MI_CLOSE)c->closing=1;
 if(r.status)s->unknown=1;
 mi_zero(payload,sizeof(payload));mi_zero(output,sizeof(output));return 1;
}
static void drop(state *s,connection *c){int original=c->fd;if(!close_owned(&c->fd)){s->unknown=1;if(s->failed_close_count<16)s->failed_close_fds[s->failed_close_count++]=original;}mi_zero(c->key,32);c->received=c->sent=c->reply_length=0;}
static void serve(state *s){
 while(!stopping){
  if(s->child>0&&!s->child_exited){pid_t p=waitpid(s->child,&s->child_status,WNOHANG);if(p==s->child)s->child_exited=1;else if(p<0){s->unknown=1;break;}}
  if(s->child_exited)break;
  struct pollfd p[MAX_CHANNELS+1];p[0]=(struct pollfd){s->listener,POLLIN,0};for(int i=0;i<MAX_CHANNELS;i++){connection *c=s->connections+i;p[i+1]=(struct pollfd){c->fd,c->reply_length?POLLOUT:POLLIN,0};}
  int result=poll(p,MAX_CHANNELS+1,50);if(result<0){if(errno==EINTR)continue;s->unknown=1;break;}
  if(p[0].revents&POLLIN){int fd=accept(s->listener,NULL,NULL);if(fd>=0){int flags=fcntl(fd,F_GETFL),yes=1;int main_peer=child_peer(s,fd),ks_source=ks_peer(s,fd),br_source=br_peer(s,fd);int role=main_peer?0:ks_source?1:2;if(flags<0||fcntl(fd,F_SETFL,flags|O_NONBLOCK)||fcntl(fd,F_SETFD,FD_CLOEXEC)||setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes))||(main_peer+ks_source+br_source!=1)){
#ifdef MI_FIXTURE_BUILD
 fputs("MI_FIXTURE_PEER_DENIED\n",stderr);
#endif
 close(fd);
}else{int placed=0;for(int i=0;i<MAX_CHANNELS;i++)if(s->connections[i].fd<0){connection *c=s->connections+i;memset(c,0,sizeof(*c));c->fd=fd;c->source_role=role;c->wanted=MI_HEADER_BYTES;c->deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;placed=1;break;}if(!placed)close(fd);}}}
  for(int i=0;i<MAX_CHANNELS;i++){
   connection *c=s->connections+i;if(c->fd<0)continue;short re=p[i+1].revents;
   if(c->deadline&&mi_now_ms()>=c->deadline){if(c->authenticated)s->unknown=1;drop(s,c);continue;}
   if(re&(POLLERR|POLLHUP|POLLNVAL)){if(c->authenticated&&!c->closing)s->unknown=1;drop(s,c);continue;}
   if(c->reply_length&&(re&POLLOUT)){ssize_t n=write(c->fd,c->reply+c->sent,c->reply_length-c->sent);if(n>0){c->sent+=(size_t)n;if(c->sent==c->reply_length){c->reply_length=c->sent=0;c->received=0;c->wanted=MI_HEADER_BYTES;c->deadline=0;if(c->closing)drop(s,c);}}else if(n<0&&errno!=EINTR&&errno!=EAGAIN){s->unknown|=c->authenticated;drop(s,c);}}
   else if(!c->reply_length&&(re&POLLIN)){
    ssize_t n=read(c->fd,c->input+c->received,c->wanted-c->received);if(n>0){if(!c->deadline)c->deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;c->received+=(size_t)n;if(c->received==MI_HEADER_BYTES&&c->wanted==MI_HEADER_BYTES&&!mi_frame_peek_size(c->input,c->received,&c->wanted)){s->unknown|=c->authenticated;drop(s,c);continue;}if(c->received==c->wanted&&!process_frame(s,c)){s->unknown|=c->authenticated;drop(s,c);}}
    else if(!n||(errno!=EINTR&&errno!=EAGAIN)){s->unknown|=c->authenticated&&!c->closing;drop(s,c);}
   }
  }
  /* Unknown forbids positive IO through current(), but existing authenticated
   * siblings retain their fixed negative CLOSE path and original sequence. */
 }
}
static int cleanup(state *s){
 if(!mi_entry_close(s))s->unknown=1;
 int good=1;for(size_t i=0;i<s->family_count;i++)if(!authority_close(s,s->families+i))good=0;for(int i=0;i<MAX_CHANNELS;i++){if(!close_owned(&s->connections[i].fd))good=0;mi_zero(s->connections[i].key,32);}if(!close_owned(&s->listener))good=0;
 for(int i=1;i<=3;i++)if(!close_owned(s->root_store.files+i))good=0;
 if(!close_owned(&s->root_store.store.receipt_fd))good=0;
 if(!store_close_fd(s,&s->root_store,&s->root_store.anchor_fd))good=0;
 if(!store_close_fd(s,&s->root_store,&s->root_store.validation_fd))good=0;
 if(s->root>=0){struct stat current_socket;const char path[]=MI_FIXED_ROOT "/" MI_SOCKET_BASENAME;if(!lstat(path,&current_socket)&&identity(&current_socket,&s->socket_identity)&&unlink(path))good=0;}
 if(!close_owned(&s->root_store.authority))good=0;if(!close_owned(&s->root))good=0;mi_zero(s->birth.seed,32);return good;
}
int main(int argc,char **argv){
 (void)argv;signal(SIGPIPE,SIG_IGN);signal(SIGCHLD,SIG_DFL);signal(SIGTERM,stop_signal);signal(SIGINT,stop_signal);if(argc!=1){fputs("MI_ARGUMENT_INVALID\n",stderr);return 64;}
 state *s=calloc(1,sizeof(*s));if(!s)return 70;s->root=s->listener=s->enrollment_control=-1;mi_cu_init(&s->enrollment_custody);store_lease_init(&s->root_store);for(size_t i=0;i<MI_AUTHORITY_MAX_LEASES;i++)store_lease_init(s->families+i);for(int i=0;i<MAX_CHANNELS;i++)s->connections[i].fd=-1;
 if(!closure(s)){cleanup(s);free(s);fputs("MI_INSTALLATION_CLOSURE_UNCONFIRMED\n",stderr);return 77;}
#ifdef MI_CUSTODY_TRANSPORT_COMPONENT
 int component_result=mi_entry_component(s);if(!s->unknown)free(s);return component_result;
#elif !defined(MI_FIXTURE_BUILD)
 if(!mi_entry_receive(s)){cleanup(s);free(s);fputs("MI_ENROLLMENT_CUSTODY_UNCONFIRMED\n",stderr);return 78;}
#endif
 if(!open_namespace(s)||!start_listener(s)||!launch(s)){
  int saved=errno;if(s->child>0){kill(s->child,SIGTERM);pid_t waited;do{waited=waitpid(s->child,&s->child_status,0);}while(waited<0&&errno==EINTR);s->child_exited=waited==s->child;if(!s->child_exited)s->unknown=1;printf("{\"event\":\"%s\",\"pid\":%ld,\"status\":%d}\n",s->child_exited?"reaped":"wait_failed",(long)s->child,s->child_status);}cleanup(s);free(s);fprintf(stderr,"MI_BIRTH_UNCONFIRMED:%d\n",saved);return 78;
 }
 serve(s);
 if(!s->child_exited&&s->child>0){kill(s->child,SIGTERM);pid_t waited;do{waited=waitpid(s->child,&s->child_status,0);}while(waited<0&&errno==EINTR);s->child_exited=waited==s->child;if(!s->child_exited)s->unknown=1;}
 int good=cleanup(s);for(size_t i=0;i<s->family_count;i++)if(s->families[i].unknown)s->unknown=1;
 printf("{\"event\":\"%s\",\"pid\":%ld,\"status\":%d,\"unknown\":%s}\n",s->child_exited?"reaped":"wait_failed",(long)s->child,s->child_status,s->unknown?"true":"false");int status=s->child_status,reaped=s->child_exited;free(s);return good&&reaped&&WIFEXITED(status)&&WEXITSTATUS(status)==0?0:79;
}
