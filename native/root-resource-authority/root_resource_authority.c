/* Original Root accounting/identity and fixed Main-role protocol component.
 * The no-fork readonly leaf owns its actual waitpid/FD facts; generic process
 * exit, Source authority and SDK-complete fate are never inferred from rows.
 * Same-UID unrestricted file/DDL isolation is NOT established by these guards.
 * Windows stays unavailable until its original identity/SQLite ABI is supplied. */
#include <node_api.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <limits.h>
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
#include "main-session-bridge.h"
#include "original-root-io-vfs.h"
#include "root-store-io-codec.h"
#include "installed-main-client.h"
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
#include "../main-installation/protocol.h"
#endif
#endif
#ifdef __APPLE__
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <pwd.h>
#include <errno.h>
#endif
#define NR_SCHEMA_VERSION 3
#define NR_PROFILE "ordinary_runtime_root_resource_reservation_writer_v7"
#define NR_DIGEST "803ead1653ac39ab8b82226ec500cebf76916c3635e4c12e2c6122a53788b780"
#define NR_GUARD "xiaok_root_resource_reservation_writer_v6"
#include "physical-resource-schema.h"
static const napi_type_tag session_tag={0x7412b93c664dec12ULL,0x91c01affb71e4dd2ULL};
#ifdef __APPLE__
struct nr_session;
struct nr_leaf;
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
static void nr_leaf_dispose(napi_env,struct nr_leaf*);
static int nr_leaf_can_settle(struct nr_leaf*);
#endif
#include "reservation-ops.h"
typedef struct nr_session {
 struct nr_session *next;
 napi_env owner_env;
 sqlite3 *db;
 int bootstrap_status,business_sealed;
 int directory,lock_fd,created_lock,created_db,bootstrap_attempted,closed,unknown,installing,fresh_owner,writing,fixture_commit_failure,fixture_cell_mismatch,fixture_process_write,fixture_bootstrap_failure,leaf_pending;
 nr_write writes[NR_MAX_WRITES];size_t write_count;
 nr_eligible *eligible;
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 nr_main_bridge *main_bridge;
 const void *main_cookie;
 nr_root_store_io *root_io;
 nr_original_root_vfs *root_vfs;
 nr_root_store_identity io_identity;
 const nr_root_bootstrap_claim *io_claim;
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
 nm_installed_client *component_client;
#endif
 unsigned source_key_slots;
#endif
 struct stat directory_identity,lock_identity,database_identity;
 char path[PATH_MAX];
} nr_session;
static int nr_protected(nr_session *s){
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 return s->root_io!=NULL;
#else
 (void)s;return 0;
#endif
}
static const char *nr_profile(nr_session *s){return nr_protected(s)?"ordinary_runtime_root_resource_reservation_writer_v8_protected_io":NR_PROFILE;}
static const char *nr_digest(nr_session *s){return nr_protected(s)?"8dc149dce2d161efe6805547451be7284377b3157510cfd60f6717defd528c59":NR_DIGEST;}
static const char *nr_guard_name(nr_session *s){return nr_protected(s)?"xiaok_root_resource_reservation_writer_v7":NR_GUARD;}
static int nr_schema_version(nr_session *s){return nr_protected(s)?4:NR_SCHEMA_VERSION;}
static int nr_table_count(nr_session *s){return nr_protected(s)?10:9;}

static _Thread_local nr_session *sessions;
static int owns(napi_env env,nr_session *candidate){for(nr_session *s=sessions;s;s=s->next)if(s==candidate)return s->owner_env==env;return 0;}
static void remove_session(nr_session *s){nr_session **slot=&sessions;while(*slot&&*slot!=s)slot=&(*slot)->next;if(*slot)*slot=s->next;}
static int same_file(const struct stat *a,const struct stat *b){return a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_uid==b->st_uid&&a->st_nlink==b->st_nlink&&a->st_mode==b->st_mode;}
static int same_directory(const struct stat *a,const struct stat *b){return S_ISDIR(a->st_mode)&&S_ISDIR(b->st_mode)&&a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_uid==b->st_uid&&a->st_mode==b->st_mode;}
static int regular(int fd,struct stat *out){return fstat(fd,out)==0&&S_ISREG(out->st_mode)&&out->st_uid==geteuid()&&out->st_nlink==1;}
/* Follow no pathname symlinks. Existing shared parents are never chmod'ed. */
static int directory_path(const char *path,int create){
 if(!path||path[0]!='/'||strlen(path)>=PATH_MAX)return -1;
 char copy[PATH_MAX];memcpy(copy,path,strlen(path)+1);int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)return -1;
 char *save=NULL;for(char *part=strtok_r(copy,"/",&save);part;part=strtok_r(NULL,"/",&save)){
  if(!strcmp(part,".")||!strcmp(part,"..")){close(fd);return -1;}
  int next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(next<0&&errno==ENOENT&&create){if(mkdirat(fd,part,0700)&&errno!=EEXIST){close(fd);return -1;}next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);}
  if(next<0){close(fd);return -1;}close(fd);fd=next;
 }return fd;
}
static int current(nr_session *s){
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->root_io){nr_root_store_identity identity;
  return nr_root_store_read_identity(s->root_io,&identity)&&nr_io_identity_same(&s->io_identity,&identity)&&
   identity.birth_state>=s->io_identity.birth_state;
 }
#endif
 struct stat directory,lock,db;int fd=directory_path(s->path,0);if(fd<0)return 0;
 int good=fstat(fd,&directory)==0&&same_directory(&directory,&s->directory_identity);close(fd);
 if(!good||fstat(s->directory,&directory)||!same_directory(&directory,&s->directory_identity)||
    !regular(s->lock_fd,&lock)||!same_file(&lock,&s->lock_identity)||
    fstatat(s->directory,"issuer.lock",&lock,AT_SYMLINK_NOFOLLOW)||!same_file(&lock,&s->lock_identity)||
    fstatat(s->directory,"root-resource-v1.sqlite",&db,AT_SYMLINK_NOFOLLOW)||!same_file(&db,&s->database_identity))return 0;
 return 1;
}
static int release(nr_session *s){
 int good=1;
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->leaf_pending){s->unknown=1;return 0;}
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
 if(s->root_io&&s->component_client){int barrier=nm_installed_root_store_close_ready(s->component_client,s->root_io);if(barrier<=0){if(barrier<0)s->unknown=1;return 0;}}
#endif
 if(s->root_io&&s->main_bridge){
  int barrier=nr_main_bridge_root_store_close_ready(s->main_bridge,s->owner_env,s->main_cookie,s->root_io);
  if(barrier<=0){if(barrier<0)s->unknown=1;return 0;}
 }
 if(s->main_bridge)nr_main_bridge_revoke(s->main_bridge,s->owner_env,s->main_cookie);
#endif
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->root_vfs){
  nr_original_root_vfs_seal(s->root_vfs);
  if(nr_original_root_vfs_close(s->root_vfs,&s->db)!=NR_SQL_FILES_CLOSED){s->unknown=1;return 0;}
 }else
#endif
 if(s->db){int rc=sqlite3_close(s->db);if(rc!=SQLITE_OK){s->unknown=1;return 0;}s->db=NULL;}
 if(s->lock_fd>=0){if(close(s->lock_fd))good=0;s->lock_fd=-1;}
 if(s->directory>=0){if(close(s->directory))good=0;s->directory=-1;}
 s->closed=1;if(!good)s->unknown=1;return good;
}
static void finalize(napi_env env,void *raw,void *hint){(void)env;(void)hint;nr_session *s=raw;if(release(s)){nr_clear_eligible(s);remove_session(s);
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->main_bridge)nr_main_bridge_release(s->main_bridge);
#endif
 free(s);}/* Failed close stays held; never delete resource rows. */}
static void guard(sqlite3_context *ctx,int argc,sqlite3_value **argv){
 nr_guard(sqlite3_user_data(ctx),ctx,argc,argv);
}
static int authorizer(void *raw,int action,const char *a,const char *b,const char *c,const char *d){
 (void)a;(void)b;(void)c;(void)d;nr_session *s=raw;
 switch(action){
  case SQLITE_ATTACH:case SQLITE_DETACH:return SQLITE_DENY;
  case SQLITE_FUNCTION:if(b&&!strcmp(b,"load_extension"))return SQLITE_DENY;return SQLITE_OK;
  case SQLITE_INSERT:case SQLITE_UPDATE:case SQLITE_DELETE:
   return s->installing||nr_authorized_write(s,action,a)?SQLITE_OK:SQLITE_DENY;
  case SQLITE_CREATE_TABLE:case SQLITE_CREATE_INDEX:case SQLITE_CREATE_TRIGGER:
  case SQLITE_DROP_TABLE:case SQLITE_DROP_INDEX:case SQLITE_DROP_TRIGGER:
  case SQLITE_ALTER_TABLE:case SQLITE_REINDEX:case SQLITE_ANALYZE:
   return s->installing?SQLITE_OK:SQLITE_DENY;
  default:return SQLITE_OK;
 }
}
static int execute(nr_session *s,const char *sql){return sqlite3_exec(s->db,sql,NULL,NULL,NULL)==SQLITE_OK;}
static int scalar(sqlite3 *db,const char *sql,sqlite3_int64 *out){
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(db,sql,-1,&stmt,NULL)==SQLITE_OK;
 if(good)good=sqlite3_step(stmt)==SQLITE_ROW&&sqlite3_column_type(stmt,0)==SQLITE_INTEGER;
 if(good){*out=sqlite3_column_int64(stmt,0);good=sqlite3_step(stmt)==SQLITE_DONE;}
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;return good;
}
static int floor_match(nr_session *s,const char *profile,const char *digest,const char *abi,int version){
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT profile,schema_version,semantic_digest,guard_abi,issuer_epoch FROM root_resource_floor WHERE singleton=1",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_step(stmt)==SQLITE_ROW;
 const char *values[]={profile,digest,abi};const int columns[]={0,2,3};
 for(int i=0;i<3&&good;i++)good=sqlite3_column_type(stmt,columns[i])==SQLITE_TEXT&&sqlite3_column_bytes(stmt,columns[i])==(int)strlen(values[i])&&!memcmp(sqlite3_column_text(stmt,columns[i]),values[i],strlen(values[i]));
 if(good)good=sqlite3_column_type(stmt,1)==SQLITE_INTEGER&&sqlite3_column_int64(stmt,1)==version&&sqlite3_column_type(stmt,4)==SQLITE_INTEGER&&sqlite3_column_int64(stmt,4)==1&&sqlite3_step(stmt)==SQLITE_DONE;
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;return good;
}
static int floor_valid(nr_session *s){return floor_match(s,nr_profile(s),nr_digest(s),nr_guard_name(s),nr_schema_version(s));}
static int floor_history_valid(nr_session *s){
 return floor_valid(s)||floor_match(s,NR_PROFILE,NR_DIGEST,NR_GUARD,NR_SCHEMA_VERSION)||floor_match(s,"ordinary_runtime_root_resource_reservation_writer_v6","1e04b496364184acbdb96b17473e83356b1c70859da0d81c9409fc6eb6f0930f","xiaok_root_resource_reservation_writer_v5",2)||floor_match(s,"ordinary_runtime_root_resource_reservation_writer_v5","92b39b7b584bb3f8dbb4ef450bae0b3fd06d01817d6b03dd43c05d293e57939b","xiaok_root_resource_reservation_writer_v4",2);
}
#endif
static napi_value fail(napi_env env,const char *message){napi_throw_error(env,NULL,message);return NULL;}
static int arguments(napi_env env,napi_callback_info info,size_t wanted,napi_value *argv){size_t count=wanted+1;return napi_get_cb_info(env,info,&count,argv,NULL,NULL)==napi_ok&&count==wanted;}
static napi_value object(napi_env env){napi_value value=NULL;napi_create_object(env,&value);return value;}
static int own_data(napi_env env,napi_value out,const char *key,napi_value value){napi_property_descriptor field={key,NULL,NULL,NULL,NULL,value,napi_enumerable,NULL};return napi_define_properties(env,out,1,&field)==napi_ok;}
static int text(napi_env env,napi_value out,const char *key,const char *value){napi_value v;return napi_create_string_utf8(env,value,NAPI_AUTO_LENGTH,&v)==napi_ok&&own_data(env,out,key,v);}
static int boolean(napi_env env,napi_value out,const char *key,int value){napi_value v;return napi_get_boolean(env,value,&v)==napi_ok&&own_data(env,out,key,v);}
static int number(napi_env env,napi_value out,const char *key,sqlite3_int64 value){napi_value v;return napi_create_int64(env,value,&v)==napi_ok&&own_data(env,out,key,v);}
static napi_value build_info(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");napi_value out=object(env);
#ifdef NR_FIXTURE_BUILD
 text(env,out,"buildKind","fixture");
 text(env,out,"compiledFixtureRoot",NR_FIXTURE_ROOT);
#else
 text(env,out,"buildKind","production_component");
#endif
 text(env,out,"physicalAbi","original_main_physical_v2_nofork_leaf");text(env,out,"profile",NR_PROFILE);text(env,out,"semanticDigest",NR_DIGEST);boolean(env,out,"nativeQualified",0);return out;
}
#ifdef __APPLE__
static nr_session *session(napi_env env,napi_value candidate,int allow_closed){
 bool tagged=false,is_null=false;nr_session *s=NULL;napi_valuetype type;napi_value null_value;
 if(napi_typeof(env,candidate,&type)!=napi_ok||napi_get_null(env,&null_value)!=napi_ok||napi_strict_equals(env,candidate,null_value,&is_null)!=napi_ok)return NULL;
 if(type!=napi_object||is_null){fail(env,"ROOT_RESOURCE_SESSION_REQUIRED");return NULL;}
 if(napi_check_object_type_tag(env,candidate,&session_tag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,candidate,(void**)&s)!=napi_ok||!s||!owns(env,s)){fail(env,"ROOT_RESOURCE_SESSION_REQUIRED");return NULL;}
 if(!allow_closed){if(s->closed){fail(env,"ROOT_RESOURCE_SESSION_CLOSED");return NULL;}if(s->unknown||!current(s)){s->unknown=1;fail(env,"ROOT_RESOURCE_SESSION_UNCONFIRMED");return NULL;}}return s;
}
/* Birth is private to this original open, never inferred from empty contents. */
static int open_birth_file(int dir,const char *name,int *created){
 int fd=openat(dir,name,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
 if(fd>=0){*created=1;return fd;}
 if(errno!=EEXIST)return -1;
 return openat(dir,name,O_RDWR|O_CLOEXEC|O_NOFOLLOW);
}
static napi_value open_original_kernel(napi_env env){
 int stage=0;nr_session *s=calloc(1,sizeof(*s));if(!s)return fail(env,"ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");s->directory=s->lock_fd=-1;
#ifdef NR_FIXTURE_BUILD
 if(snprintf(s->path,sizeof(s->path),"%s",NR_FIXTURE_ROOT)>=(int)sizeof(s->path))goto unavailable;
#else
 long size=sysconf(_SC_GETPW_R_SIZE_MAX);if(size<1024)size=16384;if(size>1048576)goto unavailable;
 char *buffer=malloc((size_t)size);struct passwd pwd,*actual=NULL;if(!buffer)goto unavailable;
 int rc=getpwuid_r(geteuid(),&pwd,buffer,(size_t)size,&actual);
 if(rc||!actual||!pwd.pw_dir||snprintf(s->path,sizeof(s->path),"%s/Library/Application Support/xiaok/runtime",pwd.pw_dir)>=(int)sizeof(s->path)){free(buffer);goto unavailable;}free(buffer);
#endif
 stage=1;
 s->directory=directory_path(s->path,1);if(s->directory<0||fstat(s->directory,&s->directory_identity)||s->directory_identity.st_uid!=geteuid())goto unavailable;
 stage=2;s->lock_fd=open_birth_file(s->directory,"issuer.lock",&s->created_lock);if(s->lock_fd<0||!regular(s->lock_fd,&s->lock_identity))goto unavailable;
 if(flock(s->lock_fd,LOCK_EX|LOCK_NB)){int busy=errno==EWOULDBLOCK||errno==EAGAIN;release(s);free(s);return fail(env,busy?"ROOT_RESOURCE_ISSUER_BUSY":"ROOT_RESOURCE_ISSUER_UNAVAILABLE");}
 stage=3;int fd=open_birth_file(s->directory,"root-resource-v1.sqlite",&s->created_db);if(fd<0)goto unavailable;
 int good=regular(fd,&s->database_identity);if(close(fd))good=0;if(!good)goto unavailable;
 char path[PATH_MAX];if(snprintf(path,sizeof(path),"%s/root-resource-v1.sqlite",s->path)>=(int)sizeof(path))goto unavailable;
 stage=4;if(sqlite3_libversion_number()<3038000||sqlite3_open_v2(path,&s->db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_NOFOLLOW,NULL)!=SQLITE_OK||!current(s))goto unavailable;
 stage=5;if(sqlite3_db_config(s->db,SQLITE_DBCONFIG_DEFENSIVE,1,NULL)!=SQLITE_OK||
    sqlite3_db_config(s->db,SQLITE_DBCONFIG_TRUSTED_SCHEMA,0,NULL)!=SQLITE_OK||
    sqlite3_create_function_v2(s->db,nr_guard_name(s),-1,SQLITE_UTF8|SQLITE_INNOCUOUS,s,guard,NULL,NULL,NULL)!=SQLITE_OK)goto unavailable;
 stage=6;if(!execute(s,"PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL"))goto unavailable;
 stage=7;if(sqlite3_set_authorizer(s->db,authorizer,s)!=SQLITE_OK)goto unavailable;
 stage=8;napi_value out=object(env);if(napi_type_tag_object(env,out,&session_tag)!=napi_ok||napi_wrap(env,out,s,finalize,NULL,NULL)!=napi_ok)goto unavailable;
 s->owner_env=env;s->next=sessions;sessions=s;
 napi_object_freeze(env,out);return out;
unavailable:{
 int primary=s->db?sqlite3_errcode(s->db):0,extended=s->db?sqlite3_extended_errcode(s->db):0,saved_errno=errno;
 if(release(s))free(s);napi_value message,error;napi_create_string_utf8(env,"ROOT_RESOURCE_NATIVE_OPEN_UNAVAILABLE",NAPI_AUTO_LENGTH,&message);napi_create_error(env,NULL,message,&error);number(env,error,"nativeStage",stage);number(env,error,"sqliteCode",primary);number(env,error,"sqliteExtendedCode",extended);number(env,error,"osError",saved_errno);napi_throw(env,error);return NULL;
}
}
static napi_value open_original(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 return open_original_kernel(env);
}
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
typedef struct {napi_env env;nr_main_bridge *bridge;napi_ref model_sdk_shape,installation_adopt;} nr_main_addon;
static napi_value main_failure(napi_env env,nr_main_result result){
 if(result==NR_MAIN_EXCEPTION_PENDING)return NULL;
 switch(result){
  case NR_MAIN_ROLE_UNAVAILABLE:return fail(env,"ROOT_RESOURCE_MAIN_ROLE_UNAVAILABLE");
  case NR_MAIN_ALREADY_ATTEMPTED:return fail(env,"ROOT_RESOURCE_MAIN_ALREADY_ATTEMPTED");
  case NR_MAIN_REVOKED:return fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REVOKED");
  case NR_MAIN_CONTEXT_REQUIRED:return fail(env,"ROOT_RESOURCE_MAIN_CONTEXT_REQUIRED");
  default:return fail(env,"ROOT_RESOURCE_MAIN_UNCONFIRMED");
 }
}
static nr_main_addon *main_addon(napi_env env,napi_callback_info info){
 void *raw=NULL;size_t count=0;
 if(napi_get_cb_info(env,info,&count,NULL,NULL,&raw)!=napi_ok||!raw)return NULL;
 nr_main_addon *addon=raw;return addon->env==env?addon:NULL;
}
static void main_env_cleanup(void *raw){
 nr_main_addon *addon=raw;nr_main_bridge_env_close(addon->bridge);
 nr_main_bridge_release(addon->bridge);if(addon->model_sdk_shape)napi_delete_reference(addon->env,addon->model_sdk_shape);if(addon->installation_adopt)napi_delete_reference(addon->env,addon->installation_adopt);free(addon);
}
static napi_value adopt_main_installation(napi_env env,napi_callback_info info);
static napi_value open_main_issuer(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_main_addon *addon=main_addon(env,info);if(!addon)return fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REQUIRED");
 nr_main_result result=nr_main_bridge_birth(addon->bridge,env,addon);
 if(result!=NR_MAIN_OK)return main_failure(env,result);
 nr_main_bridge_retain(addon->bridge);
 napi_value out=open_original_kernel(env);
 if(!out){nr_main_bridge_revoke(addon->bridge,env,addon);nr_main_bridge_release(addon->bridge);return NULL;}
 nr_session *s=session(env,out,1);
 if(!s){nr_main_bridge_revoke(addon->bridge,env,addon);nr_main_bridge_release(addon->bridge);return NULL;}
 s->main_bridge=addon->bridge;s->main_cookie=addon;
 result=nr_main_bridge_current(addon->bridge,env,addon);
 if(result!=NR_MAIN_OK){s->unknown=1;release(s);return main_failure(env,result);}
 return out;
}
/* Fixed installed entry. Its first SQLite connection is the original
 * non-default RootIO family, after same-capsule adoption and durable CLAIM.
 * No caller path, VFS name, SQL or callback is accepted. */
static napi_value open_installed_main_issuer(napi_env env,napi_callback_info info){
 napi_value args[2];
 if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_main_addon *addon=main_addon(env,info);if(!addon)return fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REQUIRED");
 nr_main_result role=nr_main_bridge_birth(addon->bridge,env,addon);
 if(role!=NR_MAIN_OK)return main_failure(env,role);
#if !defined(NR_FIXTURE_BUILD) || !defined(MI_FIXTURE_BUILD)
 /* Product genesis/canonical prior-resource provenance remains a separate
  * missing qualification. An empty protected namespace cannot mint it. */
 return fail(env,"ROOT_RESOURCE_INSTALLED_GENESIS_UNCONFIRMED");
#else
 napi_value fn,receiver,ignored;
 nr_session *s=calloc(1,sizeof(*s));if(!s)return fail(env,"ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");
 s->directory=s->lock_fd=-1;s->owner_env=env;s->main_bridge=addon->bridge;s->main_cookie=addon;
 nr_main_bridge_retain(addon->bridge);s->next=sessions;sessions=s;
 if(!addon->installation_adopt||napi_get_reference_value(env,addon->installation_adopt,&fn)!=napi_ok||
    napi_get_undefined(env,&receiver)!=napi_ok){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");}
 uint64_t call=0;if(nr_main_bridge_adoption_enter(s->main_bridge,env,addon,&call)!=NR_MAIN_OK){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");}
 napi_status invoked=napi_call_function(env,receiver,fn,1,args,&ignored);
 nr_main_result left=nr_main_bridge_adoption_leave(s->main_bridge,env,addon,call);
 if(invoked!=napi_ok||left!=NR_MAIN_OK){s->unknown=1;bool pending=false;
  if(invoked!=napi_ok&&napi_is_exception_pending(env,&pending)==napi_ok&&pending)return NULL;
  return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");
 }
 if(!nr_main_bridge_borrow_root_store(s->main_bridge,env,addon,&s->root_io)||
    !nr_root_store_read_identity(s->root_io,&s->io_identity)){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLED_IDENTITY_UNCONFIRMED");}
 if(s->io_identity.birth_state==NR_CREATED){
  if(!nr_root_store_claim_fresh(s->root_io,&s->io_claim)||!nr_root_store_read_claim(s->root_io,s->io_claim,&s->io_identity)){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLED_CLAIM_UNCONFIRMED");}
  s->created_db=s->created_lock=1;
 }
 if(nr_original_root_vfs_create(s->root_io,&s->root_vfs)!=SQLITE_OK||
    nr_original_root_vfs_open(s->root_vfs,&s->db)!=SQLITE_OK||!current(s)){
  s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLED_OPEN_UNCONFIRMED");
 }
 if(sqlite3_db_config(s->db,SQLITE_DBCONFIG_DEFENSIVE,1,NULL)!=SQLITE_OK||
    sqlite3_db_config(s->db,SQLITE_DBCONFIG_TRUSTED_SCHEMA,0,NULL)!=SQLITE_OK||
    sqlite3_create_function_v2(s->db,nr_guard_name(s),-1,SQLITE_UTF8|SQLITE_INNOCUOUS,s,guard,NULL,NULL,NULL)!=SQLITE_OK||
    !execute(s,"PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL")||
    sqlite3_set_authorizer(s->db,authorizer,s)!=SQLITE_OK){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLED_OPEN_UNCONFIRMED");}
 napi_value out=object(env);
 if(!out||napi_type_tag_object(env,out,&session_tag)!=napi_ok||napi_wrap(env,out,s,finalize,NULL,NULL)!=napi_ok||napi_object_freeze(env,out)!=napi_ok){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLED_PROJECTION_UNCONFIRMED");}
 return out;
#endif
}
/* Pure original Main-session membership precedes any role or filesystem SDK.
 * This helper cannot upgrade openOriginal() or accept a JS owner/verifier. */
static nr_session *main_session_member(napi_env env,napi_callback_info info,napi_value candidate){
 nr_session *s=session(env,candidate,1);if(!s)return NULL;
 nr_main_addon *addon=main_addon(env,info);
 if(!addon||!s->main_bridge||s->main_bridge!=addon->bridge||s->main_cookie!=addon){fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REQUIRED");return NULL;}
 return s;
}
static int main_session_current(napi_env env,nr_session *s){
 if(s->closed){fail(env,"ROOT_RESOURCE_SESSION_CLOSED");return 0;}
 if(s->unknown){fail(env,"ROOT_RESOURCE_SESSION_UNCONFIRMED");return 0;}
 nr_main_result result=nr_main_bridge_current(s->main_bridge,env,s->main_cookie);
 if(result!=NR_MAIN_OK){main_failure(env,result);return 0;}
 if(s->unknown||!current(s)){s->unknown=1;fail(env,"ROOT_RESOURCE_SESSION_UNCONFIRMED");return 0;}
 return 1;
}
/* Sole adoption glue. Existing NMP SQL/floor/queue algorithms are unchanged. */
static napi_value adopt_main_installation(napi_env env,napi_callback_info info){
 napi_value args[3],fn,receiver,out;
 if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 nr_main_addon *addon=main_addon(env,info);
 if(!addon||!addon->installation_adopt||napi_get_reference_value(env,addon->installation_adopt,&fn)!=napi_ok||
    napi_get_undefined(env,&receiver)!=napi_ok)return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");
 uint64_t call=0;
 if(nr_main_bridge_adoption_enter(s->main_bridge,env,s->main_cookie,&call)!=NR_MAIN_OK)return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");
 napi_value input[]={args[1]};
 napi_status status=napi_call_function(env,receiver,fn,1,input,&out);
 nr_main_result left=nr_main_bridge_adoption_leave(s->main_bridge,env,s->main_cookie,call);
 if(left!=NR_MAIN_OK)s->unknown=1;
 if(status!=napi_ok){
  bool pending=false;
  if(napi_is_exception_pending(env,&pending)==napi_ok&&pending)return NULL; /* Preserve the original exception. */
  s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");
 }
 if(left!=NR_MAIN_OK)return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNCONFIRMED");
 return out;
}
static napi_value assert_main_issuer(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],1);if(!s)return NULL;
 nr_main_addon *addon=main_addon(env,info);
 if(!addon||!s->main_bridge||s->main_bridge!=addon->bridge||s->main_cookie!=addon)return fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REQUIRED");
 nr_main_result result=nr_main_bridge_current(addon->bridge,env,addon);if(result!=NR_MAIN_OK)return main_failure(env,result);
 if(s->closed)return fail(env,"ROOT_RESOURCE_SESSION_CLOSED");
 if(s->unknown||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_SESSION_UNCONFIRMED");}
 napi_value out;napi_get_undefined(env,&out);return out;
}
static napi_value revoke_main_issuer(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],1);if(!s)return NULL;
 nr_main_addon *addon=main_addon(env,info);
 if(!addon||!s->main_bridge||s->main_bridge!=addon->bridge||s->main_cookie!=addon)return fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REQUIRED");
 nr_main_bridge_revoke(addon->bridge,env,addon);napi_value out;napi_get_undefined(env,&out);return out;
}
#endif
/* New positive facts from a Main-bound session require its original local
 * role lifetime. Metadata/negative settlement keep their existing session
 * health/member checks and cannot use this helper to revive an effect. */
static nr_session *effect_session(napi_env env,napi_value candidate){
 nr_session *s=session(env,candidate,1);if(!s)return NULL;
 if(s->business_sealed){fail(env,"ROOT_RESOURCE_BUSINESS_SEALED");return NULL;}
 if(s->closed){fail(env,"ROOT_RESOURCE_SESSION_CLOSED");return NULL;}
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->main_bridge){nr_main_result result=nr_main_bridge_current(s->main_bridge,env,s->main_cookie);if(result!=NR_MAIN_OK){main_failure(env,result);return NULL;}}
#endif
 if(s->unknown||!current(s)){s->unknown=1;fail(env,"ROOT_RESOURCE_SESSION_UNCONFIRMED");return NULL;}
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->root_io&&s->fresh_owner&&s->io_identity.birth_state!=NR_BOUND){fail(env,"ROOT_RESOURCE_INSTALLED_BINDING_REQUIRED");return NULL;}
#endif
 return s;
}
static const char *schema=
 "CREATE TABLE root_pool_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),identity_version INTEGER NOT NULL,pool_id TEXT NOT NULL,owner_uid INTEGER NOT NULL,directory_device INTEGER NOT NULL,directory_inode INTEGER NOT NULL,directory_mode INTEGER NOT NULL,lock_device INTEGER NOT NULL,lock_inode INTEGER NOT NULL,lock_mode INTEGER NOT NULL,database_device INTEGER NOT NULL,database_inode INTEGER NOT NULL,database_mode INTEGER NOT NULL);"
 "CREATE TABLE root_resource_floor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),profile TEXT NOT NULL,schema_version INTEGER NOT NULL,semantic_digest TEXT NOT NULL,guard_abi TEXT NOT NULL,issuer_epoch INTEGER NOT NULL);"
 "CREATE TABLE root_resource_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner_digest TEXT NOT NULL,issuer_json TEXT NOT NULL,capacity INTEGER NOT NULL,queue_limit INTEGER NOT NULL,next_seq INTEGER NOT NULL,human_burst INTEGER NOT NULL,claim_seq INTEGER NOT NULL);"
 "CREATE TABLE root_resources(record_id TEXT PRIMARY KEY,execution_key TEXT UNIQUE NOT NULL,metadata_json TEXT NOT NULL,metadata_digest TEXT NOT NULL,enqueue_seq INTEGER UNIQUE NOT NULL,revision INTEGER NOT NULL,generation INTEGER NOT NULL,issuer_epoch INTEGER NOT NULL,state TEXT NOT NULL,claim_token TEXT,attempt_id TEXT);"
 "CREATE INDEX root_resources_pending ON root_resources(state,enqueue_seq);"
 "CREATE TABLE root_launch_outbox(record_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,FOREIGN KEY(record_id) REFERENCES root_resources(record_id));"
 "CREATE TABLE root_resource_receipts(record_id TEXT NOT NULL,kind TEXT NOT NULL,binding_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(record_id,kind),FOREIGN KEY(record_id) REFERENCES root_resources(record_id));" NR_PHYSICAL_SCHEMA;
static const char *schema_io_binding=
 "CREATE TABLE root_pool_io_binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1),binding_version INTEGER NOT NULL,pool_id TEXT NOT NULL,namespace_id TEXT NOT NULL,birth_id TEXT NOT NULL,claim_id TEXT NOT NULL,anchor_digest TEXT NOT NULL,profile_digest TEXT NOT NULL,file_owner_uid INTEGER NOT NULL,directory_nlink INTEGER NOT NULL,lock_nlink INTEGER NOT NULL,database_nlink INTEGER NOT NULL,FOREIGN KEY(singleton) REFERENCES root_pool_identity(singleton));";
static napi_value install_fresh(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 sqlite3_int64 count;if(!scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count))return fail(env,"ROOT_RESOURCE_SCHEMA_UNCONFIRMED");if(count)return fail(env,"ROOT_RESOURCE_FRESH_REQUIRED");
 if(!s->created_lock||!s->created_db)return fail(env,"ROOT_RESOURCE_FRESH_BIRTH_REQUIRED");
 s->installing=1;s->writing=1;int began=execute(s,"BEGIN IMMEDIATE"),good=began;
 if(good)good=current(s)&&scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count)&&count==0&&execute(s,schema)&&(!nr_protected(s)||execute(s,schema_io_binding));
 if(good)good=nr_create_guards(s)&&nr_install_rows(s);
 if(good)good=nr_verify_frame(s)&&floor_valid(s)&&current(s);
 if(good){good=execute(s,"COMMIT");if(!good)s->unknown=1;
#ifdef NR_FIXTURE_BUILD
  /* Actual COMMIT precedes this controlled SDK wrapper failure. */
  if(good&&s->fixture_bootstrap_failure==6){s->fixture_bootstrap_failure=0;s->unknown=1;good=0;}
#endif
 }
 else if(began&&!execute(s,"ROLLBACK"))s->unknown=1;
 s->installing=0;nr_clear_frame(s);
 if(!good||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALL_UNCONFIRMED");}
 napi_value out=object(env);if(!out||!boolean(env,out,"installed",1)||s->unknown||s->closed||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALL_UNCONFIRMED");}s->fresh_owner=1;return out;
}
static napi_value read_policy(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=session(env,args[0],0);if(!s)return NULL;if(!floor_valid(s))return fail(env,"ROOT_RESOURCE_FLOOR_REQUIRED");
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT capacity,queue_limit,next_seq,claim_seq,human_burst FROM root_resource_policy WHERE singleton=1",-1,&stmt,NULL)==SQLITE_OK;
 if(good)good=sqlite3_step(stmt)==SQLITE_ROW;
 napi_value out=object(env);const char *names[]={"capacity","queueLimit","enqueueSeq","claimSeq","humanBurst"};
 for(int i=0;good&&i<5;i++){sqlite3_int64 n=sqlite3_column_int64(stmt,i);good=sqlite3_column_type(stmt,i)==SQLITE_INTEGER&&n>=0&&n<=9007199254740991LL;if(good)number(env,out,names[i],n);}
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 if(!good||s->unknown||s->closed||!floor_valid(s)||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_POLICY_UNCONFIRMED");}number(env,out,"issuerEpoch",1);if(s->unknown||s->closed||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_POLICY_UNCONFIRMED");}return out;
}
static napi_value close_session(napi_env env,napi_callback_info info){
 napi_value args[2],out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=session(env,args[0],1);if(!s)return NULL;
 if(!release(s))return fail(env,"ROOT_RESOURCE_CLOSE_UNCONFIRMED");napi_get_undefined(env,&out);return out;
}
#define NR_RESERVATION_IMPLEMENTATION
#include "reservation-ops.h"
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
#include "model-sdk-bridge.h"
#include "root-pool-bootstrap.h"
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
static napi_value component_bootstrap_installed_root_store(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nm_installed_client *client=nm_installed_create();nr_session *s=calloc(1,sizeof(*s));
 if(!client||!s)return fail(env,"ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");
 s->directory=s->lock_fd=-1;s->owner_env=env;s->component_client=client;s->next=sessions;sessions=s;
 if(!nm_installed_connect(client)||!nm_installed_borrow_root_store(client,&s->root_io)||
    !nr_root_store_read_identity(s->root_io,&s->io_identity))return fail(env,"COMPONENT_ROOT_IO_BIRTH_UNCONFIRMED");
 int original_birth=s->io_identity.birth_state;
 if(original_birth==NR_CREATED){
  if(!nr_root_store_claim_fresh(s->root_io,&s->io_claim)||!nr_root_store_read_claim(s->root_io,s->io_claim,&s->io_identity))return fail(env,"COMPONENT_ROOT_IO_CLAIM_UNCONFIRMED");
  s->created_db=s->created_lock=1;
 }
 if(nr_original_root_vfs_create(s->root_io,&s->root_vfs)!=SQLITE_OK||nr_original_root_vfs_open(s->root_vfs,&s->db)!=SQLITE_OK||!current(s))return fail(env,"COMPONENT_ROOT_IO_OPEN_UNCONFIRMED");
 if(sqlite3_db_config(s->db,SQLITE_DBCONFIG_DEFENSIVE,1,NULL)!=SQLITE_OK||sqlite3_db_config(s->db,SQLITE_DBCONFIG_TRUSTED_SCHEMA,0,NULL)!=SQLITE_OK||
    sqlite3_create_function_v2(s->db,nr_guard_name(s),-1,SQLITE_UTF8|SQLITE_INNOCUOUS,s,guard,NULL,NULL,NULL)!=SQLITE_OK||
    !execute(s,"PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL")||sqlite3_set_authorizer(s->db,authorizer,s)!=SQLITE_OK)return fail(env,"COMPONENT_ROOT_IO_SQL_UNCONFIRMED");
 napi_value private_session=object(env);if(!private_session||napi_type_tag_object(env,private_session,&session_tag)!=napi_ok||napi_wrap(env,private_session,s,finalize,NULL,NULL)!=napi_ok)return fail(env,"COMPONENT_ROOT_IO_PRIVATE_SESSION_UNCONFIRMED");
 sqlite3_int64 count=-1;if(!scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count))return fail(env,"COMPONENT_ROOT_IO_SCHEMA_UNCONFIRMED");
 if(count==0){
  if(!s->io_claim)return fail(env,"COMPONENT_ROOT_IO_NO_FRESH_CLAIM");
  /* Invoke the actual production callback with a real N-API callback frame.
   * No algorithm/SQL is reimplemented by the component. */
  napi_value fn,receiver,result;if(napi_create_function(env,"originalInstallFresh",NAPI_AUTO_LENGTH,install_fresh,NULL,&fn)!=napi_ok||napi_get_undefined(env,&receiver)!=napi_ok||napi_call_function(env,receiver,fn,1,&private_session,&result)!=napi_ok)return NULL;
 }
 if(!nr_pool_graph(env,s)||!nr_pool_bind_protected(s,count==0?NR_FRESH_COMMIT:NR_RECOVER_COMMITTED))return fail(env,"COMPONENT_ROOT_IO_GRAPH_UNCONFIRMED");

#ifdef MI_FIXTURE_AUTHORITY_SCOPES
 nr_root_store_io *other=NULL;unsigned char scope[32];memset(scope,0x11,sizeof(scope));
 if(!nm_fixture_borrow_authority_store(client,MI_FAMILY_ADMISSION,scope,&other))return fail(env,"COMPONENT_AUTHORITY_BIRTH_UNCONFIRMED");
 nr_root_store_identity other_identity;const nr_root_bootstrap_claim *other_claim=NULL;
 if(!nr_root_store_read_identity(other,&other_identity))return fail(env,"COMPONENT_AUTHORITY_IDENTITY_UNCONFIRMED");
 if(other_identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(other,&other_claim)||!nr_root_store_read_claim(other,other_claim,&other_identity)))return fail(env,"COMPONENT_AUTHORITY_CLAIM_UNCONFIRMED");
 nr_original_root_vfs *other_vfs=NULL;sqlite3 *other_db=NULL;
 if(nr_original_root_vfs_create(other,&other_vfs)!=SQLITE_OK||nr_original_root_vfs_open(other_vfs,&other_db)!=SQLITE_OK)return fail(env,"COMPONENT_AUTHORITY_OPEN_UNCONFIRMED");
 sqlite3 *same=s->db;sqlite3_int64 floor_count=0;
 if(release(s)||s->db!=same||s->closed||s->unknown||!scalar(s->db,"SELECT count(*) FROM root_resource_floor",&floor_count)||floor_count!=1)return fail(env,"COMPONENT_ROOT_CLOSED_BEFORE_AUTHORITY");
 if(sqlite3_exec(other_db,"CREATE TABLE IF NOT EXISTS component_evidence(id INTEGER PRIMARY KEY);INSERT OR IGNORE INTO component_evidence VALUES(1);",NULL,NULL,NULL)!=SQLITE_OK)return fail(env,"COMPONENT_AUTHORITY_SQL_UNCONFIRMED");
 if(nr_original_root_vfs_close(other_vfs,&other_db)!=NR_SQL_FILES_CLOSED)return fail(env,"COMPONENT_AUTHORITY_CLOSE_UNCONFIRMED");
#endif
 nr_root_store_identity identity=s->io_identity;char pool[65];nr_hex32(identity.pool_id,pool);
 napi_value out=object(env);if(!out||!text(env,out,"poolId",pool)||!text(env,out,"profile",nr_profile(s))||!number(env,out,"schemaVersion",nr_schema_version(s))||!boolean(env,out,"fresh",count==0)||!boolean(env,out,"restored",count!=0)||!boolean(env,out,"productionQualified",0))return fail(env,"COMPONENT_ROOT_IO_METADATA_UNCONFIRMED");
 if(!release(s)||!nm_installed_close_owned(client))return fail(env,"COMPONENT_ROOT_IO_CLOSE_UNCONFIRMED");
 nm_installed_fate fate;if(!nm_installed_fate_read(client,&fate)||!fate.root_files_closed||fate.unknown)return fail(env,"COMPONENT_ROOT_IO_CLOSE_UNCONFIRMED");
#ifdef MI_FIXTURE_AUTHORITY_SCOPES
 boolean(env,out,"rootCloseBeforeSqlBusy",1);boolean(env,out,"rootSameSqlHandleAfterBusy",1);boolean(env,out,"authorityPhysicallyClosed",1);
#endif
 boolean(env,out,"rootFilesClosed",fate.root_files_closed);boolean(env,out,"unknown",fate.unknown);return out;
}
#endif

#endif
#else
static napi_value open_original(napi_env env,napi_callback_info info){(void)info;return fail(env,"ROOT_RESOURCE_PLATFORM_UNAVAILABLE");}
#define install_fresh open_original
#define read_policy open_original
#define close_session open_original
#define enqueue_resource open_original
#define claim_resource open_original
#define consume_resource open_original
#define read_resource open_original
#define cancel_queued_resource open_original
#endif
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
napi_value nr_init_resource_authority(napi_env env,napi_value exports){
#else
NAPI_MODULE_INIT(){
#endif
 const napi_property_descriptor methods[]={
  {"buildInfo",NULL,build_info,NULL,NULL,NULL,napi_default,NULL},
  {"openOriginal",NULL,open_original,NULL,NULL,NULL,napi_default,NULL},
  {"installFresh",NULL,install_fresh,NULL,NULL,NULL,napi_default,NULL},
  {"readPolicy",NULL,read_policy,NULL,NULL,NULL,napi_default,NULL},
  {"close",NULL,close_session,NULL,NULL,NULL,napi_default,NULL},
  {"enqueue",NULL,enqueue_resource,NULL,NULL,NULL,napi_default,NULL},
  {"claimNext",NULL,claim_resource,NULL,NULL,NULL,napi_default,NULL},
  {"consumeLaunch",NULL,consume_resource,NULL,NULL,NULL,napi_default,NULL},
  {"finishOriginalRoot",NULL,finish_original_root,NULL,NULL,NULL,napi_default,NULL},
  {"readRecord",NULL,read_resource,NULL,NULL,NULL,napi_default,NULL},
  {"cancelQueued",NULL,cancel_queued_resource,NULL,NULL,NULL,napi_default,NULL},
#if defined(__APPLE__) && defined(NR_FIXTURE_BUILD) && defined(NR_FIXTURE_FACTS_HEADER)
  {"fixtureSubject",NULL,fixture_subject,NULL,NULL,NULL,napi_default,NULL},
  {"armCommitWrapperFailure",NULL,arm_commit_wrapper_failure,NULL,NULL,NULL,napi_default,NULL},
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
  {"armProcessIntentWriteFailure",NULL,arm_process_intent_write_failure,NULL,NULL,NULL,napi_default,NULL},
#endif
  {"armPhysicalWriteMismatch",NULL,arm_physical_write_mismatch,NULL,NULL,NULL,napi_default,NULL},
#endif
 };
 if(napi_define_properties(env,exports,sizeof(methods)/sizeof(*methods),methods)!=napi_ok)return fail(env,"ROOT_RESOURCE_EXPORT_UNAVAILABLE");
#if defined(__APPLE__) && defined(NR_MAIN_BOOTSTRAP_EMBEDDED)
 nr_main_addon *addon=calloc(1,sizeof(*addon));if(!addon)return fail(env,"ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");
 addon->env=env;
 napi_value shape;napi_valuetype shape_type;
 if(napi_get_named_property(env,exports,"__originalModelSdkPortShape",&shape)!=napi_ok||
    napi_typeof(env,shape,&shape_type)!=napi_ok||shape_type!=napi_function||
    napi_create_reference(env,shape,1,&addon->model_sdk_shape)!=napi_ok){free(addon);return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_SHAPE_UNAVAILABLE");}
 if(napi_get_named_property(env,exports,"__originalMainInstallationAdopt",&shape)!=napi_ok||napi_typeof(env,shape,&shape_type)!=napi_ok||shape_type!=napi_function||napi_create_reference(env,shape,1,&addon->installation_adopt)!=napi_ok){napi_delete_reference(env,addon->model_sdk_shape);free(addon);return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNAVAILABLE");}
 addon->bridge=nr_main_bridge_create(env,addon);
 if(!addon->bridge){napi_delete_reference(env,addon->model_sdk_shape);napi_delete_reference(env,addon->installation_adopt);free(addon);return fail(env,"ROOT_RESOURCE_MAIN_BRIDGE_UNAVAILABLE");}
 if(napi_add_env_cleanup_hook(env,main_env_cleanup,addon)!=napi_ok){main_env_cleanup(addon);return fail(env,"ROOT_RESOURCE_MAIN_CLEANUP_UNAVAILABLE");}
 const napi_property_descriptor main_methods[]={
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
  {"componentBootstrapInstalledRootStore",NULL,component_bootstrap_installed_root_store,NULL,NULL,NULL,napi_default,addon},
#endif
  {"adoptOriginalMainInstallation",NULL,adopt_main_installation,NULL,NULL,NULL,napi_default,addon},
#ifdef NR_FIXTURE_BUILD
  {"armPoolBootstrapFailure",NULL,arm_pool_bootstrap_failure,NULL,NULL,NULL,napi_default,addon},
#endif
  {"readOriginalMainPoolBootstrap",NULL,read_original_main_pool_bootstrap,NULL,NULL,NULL,napi_default,addon},
  {"sealOriginalMainRootBusiness",NULL,seal_original_main_root_business,NULL,NULL,NULL,napi_default,addon},
  {"bootstrapOriginalMainPool",NULL,bootstrap_original_main_pool,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalModelSdkBridgeKey",NULL,take_model_sdk_bridge_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalModelSdkBridge",NULL,assert_model_sdk_bridge,NULL,NULL,NULL,napi_default,addon},
  {"openOriginalInstalledMainIssuer",NULL,open_installed_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"openOriginalMainIssuer",NULL,open_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalMainIssuerCurrent",NULL,assert_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"revokeOriginalMainIssuer",NULL,revoke_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalRoomTurnSubject",NULL,import_room_subject,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalRoomDiscussionSourceKey",NULL,take_room_discussion_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalRoomDiscussionSourceKey",NULL,assert_room_discussion_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalRoomProjectSourceKey",NULL,take_room_project_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalRoomProjectSourceKey",NULL,assert_room_project_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalKSwarmDirectSourceKey",NULL,take_kswarm_direct_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalKSwarmDirectSourceKey",NULL,assert_kswarm_direct_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalDshDraftSourceKey",NULL,take_dsh_draft_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalDshDraftSourceKey",NULL,assert_dsh_draft_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalMainTurnSourceKey",NULL,take_main_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalGoalTurnSourceKey",NULL,take_goal_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalAdmissionProbeSourceKey",NULL,take_admission_probe_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalLivePreviewSourceKey",NULL,take_live_preview_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalNestedSubagentSourceKey",NULL,take_nested_subagent_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalSnapshotPrepSourceKey",NULL,take_snapshot_prep_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalToolWorkerSourceKey",NULL,take_tool_worker_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalMaterialTurnSourceKey",NULL,take_material_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalCanvasTurnSourceKey",NULL,take_canvas_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalPhysicalContext",NULL,import_physical_context,NULL,NULL,NULL,napi_default,addon},
  {"enqueueOriginalModel",NULL,enqueue_original_model,NULL,NULL,NULL,napi_default,addon},
  {"claimOriginalModel",NULL,claim_original_model,NULL,NULL,NULL,napi_default,addon},
  {"settleOriginalModel",NULL,settle_original_model,NULL,NULL,NULL,napi_default,addon},
  {"enqueueOriginalProcess",NULL,enqueue_original_process,NULL,NULL,NULL,napi_default,addon},
  {"enqueueOriginalWorkflowVmProcess",NULL,enqueue_original_workflow_vm_process,NULL,NULL,NULL,napi_default,addon},
  {"claimOriginalProcess",NULL,claim_original_process,NULL,NULL,NULL,napi_default,addon},
  {"prepareOriginalReadonlyLeaf",NULL,prepare_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"waitOriginalReadonlyLeafReady",NULL,wait_original_readonly_leaf_ready,NULL,NULL,NULL,napi_default,addon},
  {"bindOriginalReadonlyLeaf",NULL,bind_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"goOriginalReadonlyLeaf",NULL,go_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"cancelOriginalReadonlyLeaf",NULL,cancel_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"waitOriginalReadonlyLeafClosed",NULL,wait_original_readonly_leaf_closed,NULL,NULL,NULL,napi_default,addon},
  {"readOriginalProcessIntent",NULL,read_original_process_intent,NULL,NULL,NULL,napi_default,addon},
  {"readOriginalProcessHistory",NULL,read_original_process_history,NULL,NULL,NULL,napi_default,addon},
  {"settleOriginalProcess",NULL,settle_original_process,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalKSwarmTaskSubject",NULL,import_kswarm_task_subject,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalRoomProjectSubject",NULL,import_room_project_subject,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalWorkflowRootSubject",NULL,import_workflow_root_subject,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalDshDraftSubject",NULL,import_dsh_subject,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalWorkflowRootSourceKey",NULL,take_workflow_root_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalWorkflowRootSourceKey",NULL,assert_workflow_root_source_key,NULL,NULL,NULL,napi_default,addon}
 };
 if(napi_define_properties(env,exports,sizeof(main_methods)/sizeof(*main_methods),main_methods)!=napi_ok)return fail(env,"ROOT_RESOURCE_EXPORT_UNAVAILABLE");
#endif
 return exports;
}
