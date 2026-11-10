/* Original P-owned fixed readonly leaf. No caller executable, environment,
 * callback verifier or PID is accepted. READY is not a terminal certificate. */
#include <spawn.h>
#include <sys/wait.h>
#include <sys/poll.h>
#include <sys/sysctl.h>
#include <libproc.h>
#include <mach-o/dyld.h>
#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <time.h>
#ifdef NR_READONLY_LEAF_ASSETS_HEADER
#include NR_READONLY_LEAF_ASSETS_HEADER
#else
#define NR_READONLY_LEAF_ASSET_SHA256 ""
#define NR_READONLY_LEAF_ASSET_BYTES 0
#endif
extern int sandbox_check(pid_t,const char*,int,...);
#define NR_LEAF_MAX_BYTES (16U*1024U*1024U)
static const char nr_leaf_policy[]="(version 1)(allow default)(deny process-fork)(deny network*)";
struct nr_leaf {
 nr_session *session;nr_child *permit;napi_env env;napi_ref permit_ref,ready_promise,closed_promise;
 napi_deferred ready_deferred,closed_deferred;napi_async_work ready_work,closed_work;
 pthread_mutex_t mutex;pid_t pid;int input,ready,output,errors;
 int spawn_entered,spawned,spawn_error,reaped,status,ready_ok,sandbox_observed,bound,go_entered,fenced,closed,unknown,timed_out;
 int ready_busy,closed_busy;char boot[64],nonce[65],spec_hash[65],binding_hash[65],asset_hash[65],policy_hash[65];
 uint64_t started_ms;int timeout_ms;
 struct proc_bsdinfo birth;char *canonical,*stdout_data,*stderr_data;size_t stdout_size,stderr_size;
};
static int nr_leaf_close(int *fd){
 if(*fd<0)return 1;int value=*fd;*fd=-1;return close(value)==0;
}
static uint64_t nr_leaf_now_ms(void){
 struct timespec value={0};if(clock_gettime(CLOCK_MONOTONIC,&value))return 0;
 return (uint64_t)value.tv_sec*1000+(uint64_t)value.tv_nsec/1000000;
}
static int nr_leaf_expired(struct nr_leaf *l){
 uint64_t now=nr_leaf_now_ms();return !now||now<l->started_ms||now-l->started_ms>=(uint64_t)l->timeout_ms;
}
static void nr_leaf_dispose(napi_env env,struct nr_leaf *l){
 if(!l||l->ready_busy||l->closed_busy||!l->closed)return;
 if(l->permit_ref)napi_delete_reference(env,l->permit_ref);
 if(l->ready_promise)napi_delete_reference(env,l->ready_promise);
 if(l->closed_promise)napi_delete_reference(env,l->closed_promise);
 free(l->canonical);free(l->stdout_data);free(l->stderr_data);pthread_mutex_destroy(&l->mutex);free(l);
}
static int nr_leaf_can_settle(struct nr_leaf *l){
 pthread_mutex_lock(&l->mutex);int good=l->closed&&!l->unknown&&(!l->go_entered||l->bound&&l->ready_ok);pthread_mutex_unlock(&l->mutex);return good;
}
static int nr_leaf_boot(char out[64]){
 size_t size=64;if(sysctlbyname("kern.bootsessionuuid",out,&size,NULL,0)||size<2||size>64)return 0;
 return out[size-1]==0&&strlen(out)==36;
}
static int nr_leaf_sample(struct nr_leaf *l){
 struct proc_bsdinfo value={0};char boot[64];
 if(!nr_leaf_boot(boot)||strcmp(boot,l->boot)||proc_pidinfo(l->pid,PROC_PIDTBSDINFO,0,&value,sizeof(value))!=sizeof(value))return 0;
 return value.pbi_pid==(uint32_t)l->pid&&value.pbi_uid==geteuid()&&value.pbi_start_tvsec==l->birth.pbi_start_tvsec&&value.pbi_start_tvusec==l->birth.pbi_start_tvusec;
}
/* The unreaped child is owned by this original spawn. waitpid and kill share
 * the mutex so no signal can target a PID after this owner reaped it. */
static void nr_leaf_wait_locked(struct nr_leaf *l){
 if(!l->spawned||l->reaped)return;
 int status=0;pid_t p=waitpid(l->pid,&status,WNOHANG);
 if(p==l->pid){l->reaped=1;l->status=status;}
 else if(p<0&&errno!=EINTR){l->unknown=1;l->reaped=1;}
}
static void nr_leaf_cancel_locked(struct nr_leaf *l){
 l->fenced=1;nr_leaf_wait_locked(l);
 if(l->spawned&&!l->reaped&&!l->sandbox_observed){errno=0;int denied=sandbox_check(l->pid,"process-fork",0);if(denied==1&&errno==0&&nr_leaf_sample(l))l->sandbox_observed=1;}
 if(l->spawned&&!l->reaped&&kill(l->pid,SIGKILL)&&errno!=ESRCH)l->unknown=1;
 if(!nr_leaf_close(&l->input))l->unknown=1;
}
static nr_child *nr_leaf_permit(napi_env env,napi_value issuer,napi_value value,nr_session **owner){
 nr_session *s=session(env,issuer,1);if(!s)return NULL;
 nr_child *p=nr_get_child(env,value,s,NR_PROCESS_PERMIT);
 if(!p){fail(env,"ROOT_RESOURCE_PHYSICAL_PERMIT_REQUIRED");return NULL;}
 if(s->closed){fail(env,"ROOT_RESOURCE_SESSION_CLOSED");return NULL;}*owner=s;return p;
}
static int nr_leaf_row(nr_session *s,nr_child *p,nr_cell *row){
 return floor_valid(s)&&nr_physical_row(s,2,p->record.key,row)==1&&nr_intent_text(row)&&nr_intent_text(row+5)&&nr_intent_text(row+8)&&
  !strcmp((const char*)row[0].bytes,p->record.id)&&!strcmp((const char*)row[5].bytes,p->record.digest)&&!strcmp((const char*)row[8].bytes,p->record.claim)&&row[9].integer==p->record.generation&&row[10].integer==p->record.epoch&&nr_state(row,"reserved");
}
static int nr_leaf_spec(nr_session *s,const char *json,const char *expected,int *timeout_ms){
 size_t n=strlen(json);if(!n||n>NR_LEAF_MAX_BYTES)return 0;
 const char prefix[]="[\"original-process-spec-v1\",";size_t z=sizeof(prefix)-1;
 char *value=malloc(z+n+2);if(!value)return 0;memcpy(value,prefix,z);memcpy(value+z,json,n);value[z+n]=']';value[z+n+1]=0;
 unsigned char bytes[32];int good=CC_SHA256(value,(CC_LONG)(z+n+1),bytes)!=NULL;free(value);char digest[65];
 for(int i=0;i<32;i++)snprintf(digest+2*i,3,"%02x",bytes[i]);good=good&&!strcmp(digest,expected);
 sqlite3_stmt *q=NULL;
 const char *sql="SELECT json_valid(?1),json_extract(?1,'$.kind'),json_type(?1,'$.options.workerData.input'),json_extract(?1,'$.options.resourceLimits.maxOldGenerationSizeMb'),json_extract(?1,'$.options.resourceLimits.maxYoungGenerationSizeMb'),json_extract(?1,'$.options.resourceLimits.stackSizeMb'),json_array_length(?1,'$.options.execArgv'),json_extract(?1,'$.options.stdout'),json_extract(?1,'$.options.stderr'),json_extract(?1,'$.options.workerData.limits.maxEntries'),json_extract(?1,'$.options.workerData.limits.maxDirectories'),json_extract(?1,'$.options.workerData.limits.maxResults'),json_extract(?1,'$.options.workerData.limits.maxPathBytes'),json_extract(?1,'$.options.workerData.timeoutMs')";
 good=good&&sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,json,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW;
 if(good)good=sqlite3_column_int(q,0)==1&&sqlite3_column_type(q,1)==SQLITE_TEXT&&!strcmp((const char*)sqlite3_column_text(q,1),"worker")&&sqlite3_column_type(q,2)==SQLITE_TEXT&&!strcmp((const char*)sqlite3_column_text(q,2),"object");
 const sqlite3_int64 limits[]={96,8,2,0,1,1};for(int i=0;i<6&&good;i++)good=sqlite3_column_type(q,i+3)==SQLITE_INTEGER&&sqlite3_column_int64(q,i+3)==limits[i];
 const sqlite3_int64 caps[]={50000,10000,5000,2097152};for(int i=0;i<4&&good;i++)good=sqlite3_column_type(q,i+9)==SQLITE_INTEGER&&sqlite3_column_int64(q,i+9)>0&&sqlite3_column_int64(q,i+9)<=caps[i];
 if(good&&sqlite3_column_type(q,13)!=SQLITE_NULL){good=sqlite3_column_type(q,13)==SQLITE_INTEGER&&sqlite3_column_int64(q,13)>0&&sqlite3_column_int64(q,13)<=10000;if(good)*timeout_ms=sqlite3_column_int(q,13);}
 if(good)good=sqlite3_step(q)==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;return good;
}
static int nr_leaf_pipe(struct nr_leaf *l,int out[2]){
 if(pipe(out))return 0;
 if(fcntl(out[0],F_SETFD,FD_CLOEXEC)||fcntl(out[1],F_SETFD,FD_CLOEXEC)){if(!nr_leaf_close(out))l->unknown=1;if(!nr_leaf_close(out+1))l->unknown=1;return 0;}
 for(int i=0;i<2;i++)if(out[i]<4){
  int duplicate=fcntl(out[i],F_DUPFD_CLOEXEC,4);
  if(duplicate<0)return 0;
  if(!nr_leaf_close(out+i))l->unknown=1;
  out[i]=duplicate;
 }
 return 1;
}
static int nr_leaf_asset(struct nr_leaf *l,const char *path,char hash[65]){
 int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return 0;
 struct stat before={0},after={0};unsigned char digest[32];
 int good=fstat(fd,&before)==0&&S_ISREG(before.st_mode)&&before.st_nlink==1&&
  NR_READONLY_LEAF_ASSET_BYTES>0&&before.st_size==NR_READONLY_LEAF_ASSET_BYTES&&before.st_size<=NR_LEAF_MAX_BYTES;
 unsigned char *bytes=good?malloc((size_t)before.st_size):NULL;good=good&&bytes!=NULL;size_t used=0;
 while(good&&used<(size_t)before.st_size){ssize_t count=read(fd,bytes+used,(size_t)before.st_size-used);if(count<0&&errno==EINTR)continue;if(count<=0){good=0;break;}used+=(size_t)count;}
 good=good&&fstat(fd,&after)==0&&same_file(&before,&after)&&before.st_size==after.st_size&&before.st_mtimespec.tv_sec==after.st_mtimespec.tv_sec&&before.st_mtimespec.tv_nsec==after.st_mtimespec.tv_nsec&&before.st_ctimespec.tv_sec==after.st_ctimespec.tv_sec&&before.st_ctimespec.tv_nsec==after.st_ctimespec.tv_nsec&&CC_SHA256(bytes,(CC_LONG)used,digest)!=NULL;
 if(close(fd)){good=0;l->unknown=1;}free(bytes);
 if(good){for(int i=0;i<32;i++)snprintf(hash+2*i,3,"%02x",digest[i]);good=!strcmp(hash,NR_READONLY_LEAF_ASSET_SHA256);}return good;
}
/* Each manifest fact uses the existing original receipt writer. Replays compare
 * the complete TEXT values; they never mint a process permit or new nonce. */
static int nr_leaf_write_fact(struct nr_leaf *l,const char *kind,const char *json){
 nr_session *s=l->session;nr_cell resource[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};
 char hash[65];int began=nr_begin(s),good=began&&nr_leaf_row(s,l->permit,resource)&&nr_hash(json,hash)&&
  nr_text(receipt,l->permit->record.id)&&nr_text(receipt+1,kind)&&nr_text(receipt+2,hash)&&nr_text(receipt+3,json);
 sqlite3_stmt *q=NULL;int found=0;
 if(good){
  good=sqlite3_prepare_v2(s->db,"SELECT binding_hash,receipt_json FROM root_physical_receipts WHERE record_id=? AND kind=?",-1,&q,NULL)==SQLITE_OK&&
   sqlite3_bind_text(q,1,l->permit->record.id,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_text(q,2,kind,-1,SQLITE_STATIC)==SQLITE_OK;
  int step=good?sqlite3_step(q):SQLITE_ERROR;
  if(step==SQLITE_ROW){found=1;good=nr_column_equal(receipt+2,q,0)&&nr_column_equal(receipt+3,q,1)&&sqlite3_step(q)==SQLITE_DONE;}
  else good=step==SQLITE_DONE;
 }
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 if(good&&!found){nr_write *write=nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,receipt);good=write&&nr_run_write(s,write);}
 if(good)good=nr_commit(s);
 if(good)nr_clear_frame(s);
 else{if(began)sqlite3_exec(s->db,"ROLLBACK",NULL,NULL,NULL);nr_clear_frame(s);s->unknown=1;l->unknown=1;}
 nr_cells_clear(resource,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return good;
}
static int nr_leaf_write_fence(struct nr_leaf *l){
 char json[1024];snprintf(json,sizeof(json),"{\"schemaVersion\":1,\"kind\":\"original_readonly_leaf_fence_v1\",\"recordId\":\"%s\",\"launchNonce\":\"%s\",\"goEntered\":%s,\"reason\":\"original_owned_cancel\"}",l->permit->record.id,l->nonce,l->go_entered?"true":"false");
 return nr_leaf_write_fact(l,"process_fence_v1",json);
}
static int nr_leaf_write_closed(struct nr_leaf *l){
 char json[1536],binding[68];if(l->bound)snprintf(binding,sizeof(binding),"\"%s\"",l->binding_hash);else snprintf(binding,sizeof(binding),"null");
 snprintf(json,sizeof(json),"{\"schemaVersion\":1,\"kind\":\"original_readonly_leaf_closed_v1\",\"recordId\":\"%s\",\"launchNonce\":\"%s\",\"bindingHash\":%s,\"goEntered\":%s,\"readyObserved\":%s,\"fenced\":%s,\"waitKind\":\"%s\",\"exitCode\":%d,\"signal\":%d,\"profile\":\"darwin_nofork_bounded_glob_js_v1\"}",l->permit->record.id,l->nonce,binding,l->go_entered?"true":"false",l->ready_ok?"true":"false",l->fenced?"true":"false",l->spawned?"owned_waitpid":l->spawn_entered?"rejected_spawn":"not_entered",l->spawned&&WIFEXITED(l->status)?WEXITSTATUS(l->status):-1,l->spawned&&WIFSIGNALED(l->status)?WTERMSIG(l->status):0);
 return (!l->fenced||nr_leaf_write_fence(l))&&nr_leaf_write_fact(l,"process_closed_v1",json);
}
static napi_value prepare_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[4],out;if(!arguments(env,info,3,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 if(!main_session_current(env,s)||!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 napi_valuetype type;size_t n=0;if(napi_typeof(env,args[2],&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(env,args[2],NULL,0,&n)!=napi_ok||!n||n>NR_LEAF_MAX_BYTES)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_SPEC_INVALID");
 if(p->leaf){
  struct nr_leaf *prior=p->leaf;char *same=malloc(n+1);size_t copied=0;
  int equal=same&&napi_get_value_string_utf8(env,args[2],same,n+1,&copied)==napi_ok&&copied==n&&strlen(prior->canonical)==n&&!memcmp(same,prior->canonical,n);
  free(same);if(!equal)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_SPEC_CONFLICT");
  if(prior->fenced||prior->unknown)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_FENCED");
  napi_get_undefined(env,&out);return out;
 }
 struct nr_leaf *l=calloc(1,sizeof(*l));if(!l)return nr_error(env,s,"ROOT_RESOURCE_READONLY_LEAF_UNCONFIRMED",0,0,0);
 l->input=l->ready=l->output=l->errors=-1;l->env=env;l->session=s;l->permit=p;l->timeout_ms=10000;l->started_ms=nr_leaf_now_ms();pthread_mutex_init(&l->mutex,NULL);
 l->canonical=malloc(n+1);size_t read=0;nr_cell row[NR_MAX_CELLS]={0},intent[NR_MAX_CELLS]={0};
 int good=l->canonical&&napi_get_value_string_utf8(env,args[2],l->canonical,n+1,&read)==napi_ok&&read==n&&!memchr(l->canonical,0,n)&&nr_leaf_row(s,p,row)&&nr_read_process_intent(s,row,intent,p->record.attempt);
 sqlite3_stmt *q=NULL;if(good)good=sqlite3_prepare_v2(s->db,"SELECT json_extract(?1,'$.bodyHash')",-1,&q,NULL)==SQLITE_OK&&nr_bind(q,1,row+4)&&sqlite3_step(q)==SQLITE_ROW&&nr_string_column(q,0,l->spec_hash,sizeof(l->spec_hash),0)&&sqlite3_step(q)==SQLITE_DONE;
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(intent,NR_MAX_CELLS);
 good=good&&nr_leaf_spec(s,l->canonical,l->spec_hash,&l->timeout_ms)&&l->started_ms&&nr_leaf_boot(l->boot);
 if(!good){l->closed=1;nr_leaf_dispose(env,l);return fail(env,"ROOT_RESOURCE_READONLY_LEAF_SPEC_INVALID");}
 snprintf(l->nonce,sizeof(l->nonce),"%s",p->record.attempt);
 if(napi_create_reference(env,args[1],1,&l->permit_ref)!=napi_ok){l->closed=1;nr_leaf_dispose(env,l);return nr_error(env,s,"ROOT_RESOURCE_READONLY_LEAF_UNCONFIRMED",0,0,0);}
 // Publish the exact Native resource row before opening even the fixed asset
 // or any pipe. Failure never discards an entered close/FD uncertainty.
 p->leaf=l;s->leaf_pending++;
 char runtime[PATH_MAX],driver[PATH_MAX];uint32_t size=sizeof(runtime);Dl_info image={0};
 good=_NSGetExecutablePath(runtime,&size)==0&&dladdr((void*)&prepare_original_readonly_leaf,&image)&&image.dli_fname&&strlen(image.dli_fname)<sizeof(driver);
 if(good){snprintf(driver,sizeof(driver),"%s",image.dli_fname);char *slash=strrchr(driver,'/');good=slash!=NULL;if(slash){*slash=0;size_t used=strlen(driver);good=snprintf(driver+used,sizeof(driver)-used,"/readonly-leaf-driver.mjs")>0&&strlen(driver)<sizeof(driver)-1;}}
 int request[2]={-1,-1},ready[2]={-1,-1},output[2]={-1,-1},errors[2]={-1,-1};
 good=good&&nr_leaf_asset(l,driver,l->asset_hash)&&nr_hash(nr_leaf_policy,l->policy_hash)&&nr_leaf_pipe(l,request)&&nr_leaf_pipe(l,ready)&&nr_leaf_pipe(l,output)&&nr_leaf_pipe(l,errors);
 good=good&&!l->unknown;
 if(!good){
  for(int i=0;i<2;i++){
   if(!nr_leaf_close(request+i))l->unknown=1;
   if(!nr_leaf_close(ready+i))l->unknown=1;
   if(!nr_leaf_close(output+i))l->unknown=1;
   if(!nr_leaf_close(errors+i))l->unknown=1;
  }
  return fail(env,"ROOT_RESOURCE_READONLY_LEAF_ASSET_REQUIRED");
 }
 posix_spawn_file_actions_t actions;posix_spawnattr_t attributes;int actions_ready=posix_spawn_file_actions_init(&actions)==0,attributes_ready=posix_spawnattr_init(&attributes)==0;
 if(!actions_ready||!attributes_ready)l->unknown=1;
 good=actions_ready&&attributes_ready&&posix_spawn_file_actions_adddup2(&actions,request[0],0)==0&&posix_spawn_file_actions_adddup2(&actions,output[1],1)==0&&posix_spawn_file_actions_adddup2(&actions,errors[1],2)==0&&posix_spawn_file_actions_adddup2(&actions,ready[1],3)==0&&posix_spawnattr_setflags(&attributes,POSIX_SPAWN_CLOEXEC_DEFAULT)==0;
 char *argv[]={"/usr/bin/sandbox-exec","-p",(char*)nr_leaf_policy,runtime,"--max-old-space-size=96","--max-semi-space-size=4","--stack-size=2048",driver,l->nonce,l->spec_hash,NULL};
 char *environment[]={"ELECTRON_RUN_AS_NODE=1","PATH=/usr/bin:/bin","LANG=C.UTF-8",NULL};
 if(good){l->spawn_entered=1;l->spawn_error=posix_spawn(&l->pid,argv[0],&actions,&attributes,argv,environment);}
 else l->spawn_error=EINVAL;
 if(actions_ready&&posix_spawn_file_actions_destroy(&actions))l->unknown=1;
 if(attributes_ready&&posix_spawnattr_destroy(&attributes))l->unknown=1;
 l->input=request[1];l->ready=ready[0];l->output=output[0];l->errors=errors[0];
 if(!nr_leaf_close(request))l->unknown=1;
 if(!nr_leaf_close(ready+1))l->unknown=1;
 if(!nr_leaf_close(output+1))l->unknown=1;
 if(!nr_leaf_close(errors+1))l->unknown=1;
 if(!l->spawn_error){l->spawned=1;if(proc_pidinfo(l->pid,PROC_PIDTBSDINFO,0,&l->birth,sizeof(l->birth))!=sizeof(l->birth)||l->birth.pbi_pid!=(uint32_t)l->pid||l->birth.pbi_uid!=geteuid())l->unknown=1;}
 else l->reaped=1;
 if(fcntl(l->input,F_SETNOSIGPIPE,1))l->unknown=1;
 if(l->unknown){pthread_mutex_lock(&l->mutex);nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);return fail(env,"ROOT_RESOURCE_READONLY_LEAF_PREPARE_UNCONFIRMED");}
 napi_get_undefined(env,&out);return out;
}
static void nr_leaf_ready_execute(napi_env env,void *data){
 (void)env;struct nr_leaf *l=data;char buffer[256];size_t used=0;int good=1;
 if(!l->spawned)return;
 while(used<sizeof(buffer)-1){
  if(nr_leaf_expired(l)){good=0;l->timed_out=1;break;}
  struct pollfd ready={l->ready,POLLIN|POLLHUP,0};int polled=poll(&ready,1,10);
  if(polled<0&&errno==EINTR)continue;
  if(polled<0){good=0;l->unknown=1;break;}if(!polled)continue;
  ssize_t n=read(l->ready,buffer+used,sizeof(buffer)-1-used);if(n<0&&errno==EINTR)continue;if(n<=0){good=0;break;}used+=(size_t)n;if(memchr(buffer,'\n',used))break;
 }
 buffer[used]=0;char expected[160];snprintf(expected,sizeof(expected),"READY %s %s\n",l->nonce,l->spec_hash);
 pthread_mutex_lock(&l->mutex);nr_leaf_wait_locked(l);errno=0;int denied=l->spawned&&!l->reaped?sandbox_check(l->pid,"process-fork",0):-1;
 int kernel_good=denied==1&&errno==0&&nr_leaf_sample(l);if(kernel_good)l->sandbox_observed=1;
 good=good&&!strcmp(buffer,expected)&&!l->fenced&&!l->reaped&&kernel_good;
 if(!nr_leaf_close(&l->ready))l->unknown=1;l->ready_ok=good&&!l->unknown;pthread_mutex_unlock(&l->mutex);
}
static napi_value nr_leaf_error(napi_env env,const char *message){napi_value text_value,error;napi_create_string_utf8(env,message,NAPI_AUTO_LENGTH,&text_value);napi_create_error(env,NULL,text_value,&error);return error;}
static void nr_leaf_ready_complete(napi_env env,napi_status status,void *data){
 struct nr_leaf *l=data;l->ready_busy=0;
 if(status==napi_ok&&l->ready_ok){napi_value token,parent;nr_child *c=NULL;if(napi_get_reference_value(env,l->permit->parent_ref,&parent)==napi_ok)c=nr_new_child(env,parent,l->session,NR_LEAF_READY,&token);
  if(c){c->leaf=l;snprintf(c->record.id,sizeof(c->record.id),"%s",l->permit->record.id);snprintf(c->record.attempt,sizeof(c->record.attempt),"%s",l->nonce);c->valid=1;napi_resolve_deferred(env,l->ready_deferred,token);}else napi_reject_deferred(env,l->ready_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED"));
 }else napi_reject_deferred(env,l->ready_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED"));
 napi_delete_async_work(env,l->ready_work);l->ready_work=NULL;
}
static napi_value wait_original_readonly_leaf_ready(napi_env env,napi_callback_info info){
 napi_value args[3],promise,label;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 struct nr_leaf *l=p->leaf;if(!l)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_REQUIRED");
 if(l->ready_promise){napi_get_reference_value(env,l->ready_promise,&promise);return promise;}
 if(napi_create_promise(env,&l->ready_deferred,&promise)!=napi_ok||napi_create_reference(env,promise,1,&l->ready_promise)!=napi_ok||napi_create_string_utf8(env,"original-readonly-ready",NAPI_AUTO_LENGTH,&label)!=napi_ok)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED");
 l->ready_busy=1;if(napi_create_async_work(env,NULL,label,nr_leaf_ready_execute,nr_leaf_ready_complete,l,&l->ready_work)!=napi_ok||napi_queue_async_work(env,l->ready_work)!=napi_ok){
  l->ready_busy=0;l->unknown=1;
  pthread_mutex_lock(&l->mutex);nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);
  if(l->ready_work){napi_delete_async_work(env,l->ready_work);l->ready_work=NULL;}
  napi_reject_deferred(env,l->ready_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED"));
 }return promise;
}
static napi_value bind_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[4],out;if(!arguments(env,info,3,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 nr_child *token=nr_get_child(env,args[2],s,NR_LEAF_READY);struct nr_leaf *l=p->leaf;
 if(!l||!token||token->leaf!=l||strcmp(token->record.id,p->record.id)||strcmp(token->record.attempt,l->nonce))return fail(env,"ROOT_RESOURCE_READONLY_LEAF_READY_REQUIRED");
 if(!main_session_current(env,s)||!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 pthread_mutex_lock(&l->mutex);int good=l->ready_ok&&!l->fenced&&!l->unknown&&!l->go_entered;nr_leaf_wait_locked(l);good=good&&!l->reaped&&nr_leaf_sample(l);pthread_mutex_unlock(&l->mutex);
 if(!good)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_BINDING_UNCONFIRMED");
 char json[2048],hash[65];snprintf(json,sizeof(json),"{\"schemaVersion\":1,\"kind\":\"original_readonly_leaf_binding_v1\",\"recordId\":\"%s\",\"launchNonce\":\"%s\",\"claimToken\":\"%s\",\"specHash\":\"%s\",\"issuerEpoch\":%lld,\"acquireGeneration\":%lld,\"bootId\":\"%s\",\"pid\":%d,\"uid\":%u,\"startSeconds\":%llu,\"startMicros\":%llu,\"profile\":\"darwin_nofork_bounded_glob_js_v1\",\"assetHash\":\"%s\",\"policyHash\":\"%s\"}",p->record.id,l->nonce,p->record.claim,l->spec_hash,(long long)p->record.epoch,(long long)p->record.generation,l->boot,l->pid,l->birth.pbi_uid,l->birth.pbi_start_tvsec,l->birth.pbi_start_tvusec,l->asset_hash,l->policy_hash);
 nr_cell row[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};int began=nr_begin(s),committed=0;
 good=began&&nr_leaf_row(s,p,row)&&nr_hash(json,hash)&&nr_text(receipt,p->record.id)&&nr_text(receipt+1,"process_binding_v1")&&nr_text(receipt+2,hash)&&nr_text(receipt+3,json);
 sqlite3_stmt *q=NULL;int found=0;if(good){good=sqlite3_prepare_v2(s->db,"SELECT binding_hash,receipt_json FROM root_physical_receipts WHERE record_id=? AND kind='process_binding_v1'",-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,p->record.id,-1,SQLITE_STATIC)==SQLITE_OK;int step=good?sqlite3_step(q):SQLITE_ERROR;if(step==SQLITE_ROW){found=1;good=nr_column_equal(receipt+2,q,0)&&nr_column_equal(receipt+3,q,1)&&sqlite3_step(q)==SQLITE_DONE;}else good=step==SQLITE_DONE;}
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 if(good&&!found){nr_write *w=nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,receipt);good=w&&nr_run_write(s,w);}
 if(good)good=nr_commit(s);if(good){committed=1;nr_clear_frame(s);snprintf(l->binding_hash,sizeof(l->binding_hash),"%s",hash);l->bound=1;}
 nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);if(!good)return nr_abort(env,s,"ROOT_RESOURCE_READONLY_LEAF_BINDING_UNCONFIRMED",began,committed);
 napi_get_undefined(env,&out);return out;
}
static napi_value go_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;struct nr_leaf *l=p->leaf;
 if(!l||!main_session_current(env,s)||!s->fresh_owner)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_REQUIRED");
 pthread_mutex_lock(&l->mutex);nr_leaf_wait_locked(l);int good=l->bound&&l->ready_ok&&!l->fenced&&!l->unknown&&!l->go_entered&&!l->reaped&&current(s);if(good)l->go_entered=1;pthread_mutex_unlock(&l->mutex);if(!good)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_GO_REFUSED");
 size_t size=strlen(l->canonical)+160;char *frame=malloc(size);if(!frame){l->unknown=1;return fail(env,"ROOT_RESOURCE_READONLY_LEAF_GO_UNCONFIRMED");}
 int n=snprintf(frame,size,"GO %s %s\n%s",l->nonce,l->spec_hash,l->canonical);size_t offset=0;
 while(n>0&&offset<(size_t)n){ssize_t count=write(l->input,frame+offset,(size_t)n-offset);if(count<0&&errno==EINTR)continue;if(count<=0){good=0;break;}offset+=(size_t)count;}

 free(frame);if(!nr_leaf_close(&l->input))good=0;if(!good){l->unknown=1;return fail(env,"ROOT_RESOURCE_READONLY_LEAF_GO_UNCONFIRMED");}napi_get_undefined(env,&out);return out;
}
static napi_value cancel_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 if(p->leaf){
  struct nr_leaf *l=p->leaf;pthread_mutex_lock(&l->mutex);
  // A completed operation stays immutable when cleanup is repeated.
  int already_closed=l->closed;if(!already_closed)nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);
  if(!already_closed&&!nr_leaf_write_fence(l))return nr_error(env,s,"ROOT_RESOURCE_READONLY_LEAF_FENCE_UNCONFIRMED",sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);
 }napi_get_undefined(env,&out);return out;
}
static int nr_leaf_read_output(struct nr_leaf *l,int *fd,char **buffer,size_t *used){
 if(*fd<0)return 1;char bytes[8192];ssize_t count=read(*fd,bytes,sizeof(bytes));
 if(count<0&&(errno==EINTR||errno==EAGAIN))return 1;
 if(count<=0){if(count<0)l->unknown=1;if(!nr_leaf_close(fd))l->unknown=1;return 1;}
 if(*used+(size_t)count>NR_LEAF_MAX_BYTES){l->unknown=1;return 0;}
 char *next=realloc(*buffer,*used+(size_t)count+1);if(!next){l->unknown=1;return 0;}*buffer=next;memcpy(next+*used,bytes,(size_t)count);*used+=(size_t)count;next[*used]=0;return 1;
}
static void nr_leaf_closed_execute(napi_env env,void *data){
 (void)env;struct nr_leaf *l=data;
 if(l->output>=0&&fcntl(l->output,F_SETFL,O_NONBLOCK))l->unknown=1;
 if(l->errors>=0&&fcntl(l->errors,F_SETFL,O_NONBLOCK))l->unknown=1;
 for(;;){
  pthread_mutex_lock(&l->mutex);nr_leaf_wait_locked(l);
 int output_good=nr_leaf_read_output(l,&l->output,&l->stdout_data,&l->stdout_size);
  int errors_good=nr_leaf_read_output(l,&l->errors,&l->stderr_data,&l->stderr_size);
  if(nr_leaf_expired(l)){l->timed_out=1;nr_leaf_cancel_locked(l);}
  if(!output_good||!errors_good)nr_leaf_cancel_locked(l);
  int done=(!l->spawned||l->reaped)&&l->output<0&&l->errors<0;pthread_mutex_unlock(&l->mutex);if(done)break;
  struct pollfd fds[2]={{l->output,POLLIN|POLLHUP,0},{l->errors,POLLIN|POLLHUP,0}};
  if(poll(fds,2,10)<0&&errno!=EINTR){pthread_mutex_lock(&l->mutex);l->unknown=1;nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);}
 }
 pthread_mutex_lock(&l->mutex);
 if(!nr_leaf_close(&l->input))l->unknown=1;
 if(!nr_leaf_close(&l->ready))l->unknown=1;
 /* A payload requires the actually observed no-fork kernel gate. No GO may
  * settle only the exact owned child after cancellation, never a PID census. */
 if(l->go_entered&&(!l->ready_ok||!l->bound))l->unknown=1;
 if(l->spawned&&!l->sandbox_observed)l->unknown=1;
 l->closed=1;pthread_mutex_unlock(&l->mutex);
}
static void nr_leaf_closed_complete(napi_env env,napi_status status,void *data){
 struct nr_leaf *l=data;l->closed_busy=0;if(l->session->leaf_pending>0)l->session->leaf_pending--;
 napi_value out=object(env);int good=status==napi_ok&&!l->unknown&&nr_leaf_write_closed(l)&&out&&text(env,out,"stdout",l->stdout_data?l->stdout_data:"")&&text(env,out,"stderr",l->stderr_data?l->stderr_data:"")&&number(env,out,"exitCode",l->spawned&&WIFEXITED(l->status)?WEXITSTATUS(l->status):-1)&&number(env,out,"signal",l->spawned&&WIFSIGNALED(l->status)?WTERMSIG(l->status):0)&&boolean(env,out,"timedOut",l->timed_out);
 if(good)napi_resolve_deferred(env,l->closed_deferred,out);else napi_reject_deferred(env,l->closed_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_CLOSED_UNCONFIRMED"));
 napi_delete_async_work(env,l->closed_work);l->closed_work=NULL;
 napi_ref held=l->permit_ref;l->permit_ref=NULL;
 if(held)napi_delete_reference(env,held);
}
static napi_value wait_original_readonly_leaf_closed(napi_env env,napi_callback_info info){
 napi_value args[3],promise,label;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;struct nr_leaf *l=p->leaf;
 if(!l)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_REQUIRED");if(l->closed_promise){napi_get_reference_value(env,l->closed_promise,&promise);return promise;}
 if(l->ready_busy)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_READY_PENDING");
 if(napi_create_promise(env,&l->closed_deferred,&promise)!=napi_ok||napi_create_reference(env,promise,1,&l->closed_promise)!=napi_ok||napi_create_string_utf8(env,"original-readonly-closed",NAPI_AUTO_LENGTH,&label)!=napi_ok)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_CLOSED_UNCONFIRMED");
 l->closed_busy=1;if(napi_create_async_work(env,NULL,label,nr_leaf_closed_execute,nr_leaf_closed_complete,l,&l->closed_work)!=napi_ok||napi_queue_async_work(env,l->closed_work)!=napi_ok){
  l->closed_busy=0;l->unknown=1;
  pthread_mutex_lock(&l->mutex);nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);
  if(l->closed_work){napi_delete_async_work(env,l->closed_work);l->closed_work=NULL;}
  napi_reject_deferred(env,l->closed_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_CLOSED_UNCONFIRMED"));
 }return promise;
}

#include "readonly-leaf-history.h"
