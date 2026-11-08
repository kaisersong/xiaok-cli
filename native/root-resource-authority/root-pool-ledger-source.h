/* Existing-only OS-account source. This never enters open/bootstrap, creates a
 * namespace, recovers SQLite, migrates a floor or returns a resource session. */
#define NR_LEDGER_ANCESTORS (PATH_MAX/2)
typedef struct nr_ledger_source {
 struct nr_ledger_source *next;nr_session view;napi_env env;
 int fds[NR_LEDGER_ANCESTORS],count,probe,unknown,first_errno;
 int failed_fds[NR_LEDGER_ANCESTORS+2],failed_count;
 struct stat facts[NR_LEDGER_ANCESTORS];char names[PATH_MAX];size_t offsets[NR_LEDGER_ANCESTORS];
} nr_ledger_source;
static _Thread_local nr_ledger_source *nr_ledger_sources;
static int nr_ledger_sidecars(nr_session *s){
 const char *names[]={"root-resource-v1.sqlite-journal","root-resource-v1.sqlite-wal","root-resource-v1.sqlite-shm"};struct stat st;
 for(size_t i=0;i<sizeof(names)/sizeof(*names);i++){if(!fstatat(s->directory,names[i],&st,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT)return 0;}return 1;
}
static int nr_ledger_existing_current(nr_session *s){
 nr_ledger_source *r=s->ledger_source;struct stat st;
 if(!r||r->unknown||s->birth_pid!=getpid()||r->count<1||!nr_ledger_sidecars(s))return 0;
 for(int i=0;i<r->count;i++){
  if(fstat(r->fds[i],&st)||!same_directory(&st,&r->facts[i]))return 0;
  if(i&&(fstatat(r->fds[i-1],r->names+r->offsets[i],&st,AT_SYMLINK_NOFOLLOW)||!same_directory(&st,&r->facts[i])))return 0;
 }
 return regular(s->lock_fd,&st)&&same_file(&st,&s->lock_identity)&&
  !fstatat(s->directory,"issuer.lock",&st,AT_SYMLINK_NOFOLLOW)&&same_file(&st,&s->lock_identity)&&
  regular(r->probe,&st)&&same_file(&st,&s->database_identity)&&
  !fstatat(s->directory,"root-resource-v1.sqlite",&st,AT_SYMLINK_NOFOLLOW)&&same_file(&st,&s->database_identity);
}
static int nr_ledger_close_fd(nr_ledger_source *r,int *fd){
 if(*fd<0)return 1;
 for(int i=0;i<r->failed_count;i++)if(r->failed_fds[i]==*fd)return 0;
 if(close(*fd)){if(!r->first_errno)r->first_errno=errno;r->failed_fds[r->failed_count++]=*fd;r->unknown=1;return 0;}*fd=-1;return 1;
}
static int nr_ledger_source_release(nr_ledger_source *r){
 nr_session *s=&r->view;int good=1;
 if(s->schema_reference){int rc=sqlite3_close(s->schema_reference);if(rc==SQLITE_OK)s->schema_reference=NULL;else{r->unknown=1;good=0;}}
 if(s->db){int rc=sqlite3_close(s->db);if(rc==SQLITE_OK)s->db=NULL;else{r->unknown=1;good=0;}}
 /* Keep the issuer lock and ancestors while either actual SQLite handle is
  * still held. The independent probe is always attempted. */
 if(!nr_ledger_close_fd(r,&r->probe))good=0;
 if(!s->db&&!s->schema_reference){
  if(!nr_ledger_close_fd(r,&s->lock_fd))good=0;
  for(int i=r->count-1;i>=0;i--)if(!nr_ledger_close_fd(r,&r->fds[i]))good=0;
 }
 if(good)s->closed=1;return good;
}
static void nr_ledger_source_remove(nr_ledger_source *r){nr_ledger_source **p=&nr_ledger_sources;while(*p&&*p!=r)p=&(*p)->next;if(*p)*p=r->next;}
static void nr_ledger_source_cleanup(void *raw){nr_ledger_source *r=raw;if(nr_ledger_source_release(r)){nr_ledger_source_remove(r);free(r);}}
static int nr_ledger_source_done(napi_env env,nr_ledger_source *r){
 int good=nr_ledger_source_release(r);
 if(r->unknown||r->view.unknown)return 0;
 if(good&&napi_remove_env_cleanup_hook(env,nr_ledger_source_cleanup,r)==napi_ok){nr_ledger_source_remove(r);free(r);return 1;}
 r->unknown=1;return 0;
}
static int nr_ledger_existing_path(nr_session *s){
#ifdef NR_FIXTURE_BUILD
 return snprintf(s->path,sizeof(s->path),"%s",NR_FIXTURE_ROOT)<(int)sizeof(s->path);
#else
 long n=sysconf(_SC_GETPW_R_SIZE_MAX);if(n<1024)n=16384;if(n>1048576)return 0;
 char *buffer=malloc((size_t)n);struct passwd pwd,*actual=NULL;if(!buffer)return 0;
 int rc=getpwuid_r(geteuid(),&pwd,buffer,(size_t)n,&actual);
 int good=!rc&&actual&&pwd.pw_dir&&snprintf(s->path,sizeof(s->path),"%s/Library/Application Support/xiaok/runtime",pwd.pw_dir)<(int)sizeof(s->path);free(buffer);return good;
#endif
}
static int nr_ledger_existing_directories(nr_ledger_source *r){
 nr_session *s=&r->view;if(s->path[0]!='/'||strlen(s->path)>=sizeof(r->names))return 0;
 memcpy(r->names,s->path,strlen(s->path)+1);r->fds[0]=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(r->fds[0]<0)return 0;r->count=1;
 if(fstat(r->fds[0],r->facts))return 0;
 char *save=NULL;for(char *part=strtok_r(r->names,"/",&save);part;part=strtok_r(NULL,"/",&save)){
  if(!strcmp(part,".")||!strcmp(part,"..")||r->count==NR_LEDGER_ANCESTORS)return 0;
  int i=r->count;r->offsets[i]=(size_t)(part-r->names);r->fds[i]=openat(r->fds[i-1],part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(r->fds[i]<0)return 0;r->count++;
  if(fstat(r->fds[i],r->facts+i)||!S_ISDIR(r->facts[i].st_mode))return 0;
 }
 s->directory=r->fds[r->count-1];s->directory_identity=r->facts[r->count-1];return s->directory_identity.st_uid==geteuid();
}
static napi_value close_root_pool_ledger_source(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");int good=1;
 for(nr_ledger_source *r=nr_ledger_sources,*next;r;r=next){next=r->next;if(r->env==env&&!nr_ledger_source_done(env,r))good=0;}
 if(!good)return fail(env,"ROOT_LEDGER_CLOSE_UNCONFIRMED");napi_value out;napi_get_undefined(env,&out);return out;
}
static napi_value capture_existing_root_pool_ledger(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 if(__builtin_available(macOS 12.3,*)){}else return fail(env,"ROOT_LEDGER_RUNTIME_UNSUPPORTED");
 for(nr_ledger_source *old=nr_ledger_sources;old;old=old->next)if(old->env==env)return fail(env,"ROOT_LEDGER_SOURCE_HELD");
 nr_ledger_source *r=calloc(1,sizeof(*r));if(!r)return fail(env,"ROOT_LEDGER_ALLOCATION_FAILED");
 r->env=env;r->probe=-1;r->view.directory=r->view.lock_fd=-1;r->view.birth_pid=getpid();r->view.owner_env=env;r->view.ledger_source=r;
 for(int i=0;i<NR_LEDGER_ANCESTORS;i++)r->fds[i]=-1;
 /* Strong row and cleanup exist before the first OS/SQLite SDK operation. */
 if(napi_add_env_cleanup_hook(env,nr_ledger_source_cleanup,r)!=napi_ok){free(r);return fail(env,"ROOT_LEDGER_CUSTODY_UNAVAILABLE");}r->next=nr_ledger_sources;nr_ledger_sources=r;
 nr_session *s=&r->view;const char *error="ROOT_LEDGER_SOURCE_UNCONFIRMED";nr_ledger_bytes bytes={0};
 int good=nr_ledger_existing_path(s)&&nr_ledger_existing_directories(r);
 if(!good&&errno==ENOENT)error="ROOT_LEDGER_SOURCE_MISSING";
 if(good){s->lock_fd=openat(s->directory,"issuer.lock",O_RDONLY|O_CLOEXEC|O_NOFOLLOW);good=s->lock_fd>=0&&regular(s->lock_fd,&s->lock_identity);if(!good&&errno==ENOENT)error="ROOT_LEDGER_SOURCE_MISSING";}
 if(good&&flock(s->lock_fd,LOCK_EX|LOCK_NB)){good=0;error=(errno==EWOULDBLOCK||errno==EAGAIN)?"ROOT_LEDGER_ISSUER_BUSY":"ROOT_LEDGER_SOURCE_UNCONFIRMED";}
 if(good){r->probe=openat(s->directory,"root-resource-v1.sqlite",O_RDONLY|O_CLOEXEC|O_NOFOLLOW);good=r->probe>=0&&regular(r->probe,&s->database_identity);if(!good&&errno==ENOENT)error="ROOT_LEDGER_SOURCE_MISSING";}
 if(good&&!nr_ledger_sidecars(s)){good=0;error="ROOT_LEDGER_RECOVERY_REQUIRED";}
 char path[PATH_MAX];if(good)good=snprintf(path,sizeof(path),"%s/root-resource-v1.sqlite",s->path)<(int)sizeof(path);
 if(good)good=sqlite3_open_v2(path,&s->db,SQLITE_OPEN_READONLY|SQLITE_OPEN_NOFOLLOW,NULL)==SQLITE_OK&&
  sqlite3_db_config(s->db,SQLITE_DBCONFIG_DEFENSIVE,1,NULL)==SQLITE_OK&&sqlite3_db_config(s->db,SQLITE_DBCONFIG_TRUSTED_SCHEMA,0,NULL)==SQLITE_OK&&current(s);
 if(good)good=nr_ledger_capture(env,s,"existing-ordinary-readonly",&bytes,&error);
 if(!nr_ledger_source_done(env,r)){
  const char *primary=good?"ROOT_LEDGER_CLOSE_UNCONFIRMED":error;nr_ledger_clear(&bytes);
  napi_value message,exception;napi_create_string_utf8(env,primary,NAPI_AUTO_LENGTH,&message);napi_create_error(env,NULL,message,&exception);
  text(env,exception,"cleanupError","ROOT_LEDGER_CLOSE_UNCONFIRMED");number(env,exception,"osError",r->first_errno);napi_throw(env,exception);return NULL;
 }
 if(!good){nr_ledger_clear(&bytes);return fail(env,error);}return nr_ledger_projection(env,&bytes);
}
