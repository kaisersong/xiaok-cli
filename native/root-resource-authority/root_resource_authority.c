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
#if defined(NR_LEDGER_SOURCE_ADDON) && defined(NR_MAIN_BOOTSTRAP_EMBEDDED)
#error Independent ledger Source must not embed Main authority
#endif
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
 struct nr_ledger_source *ledger_source;
 napi_env owner_env;
 sqlite3 *db,*schema_reference;
#ifdef NR_FIXTURE_BUILD
 sqlite3_stmt *fixture_schema_statement;int fixture_schema_busy;
#endif
 pid_t birth_pid;int ledger_reading,ledger_failure_code;
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

#if defined(NR_MAIN_BOOTSTRAP_EMBEDDED) || defined(NR_LEDGER_SOURCE_ADDON)
static int nr_ledger_existing_current(nr_session *s);
#endif
static int current(nr_session *s){

#if defined(NR_MAIN_BOOTSTRAP_EMBEDDED) || defined(NR_LEDGER_SOURCE_ADDON)
 if(s->ledger_source)return nr_ledger_existing_current(s);
#endif
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
 int good=1;if(s->ledger_reading)return 0;
 #ifdef NR_FIXTURE_BUILD
 if(s->fixture_schema_statement){if(sqlite3_finalize(s->fixture_schema_statement)!=SQLITE_OK){s->unknown=1;return 0;}s->fixture_schema_statement=NULL;}
 #endif
 if(s->schema_reference){int rc=sqlite3_close(s->schema_reference);if(rc!=SQLITE_OK){if(!s->ledger_failure_code)s->ledger_failure_code=rc;s->unknown=1;good=0;}else s->schema_reference=NULL;}
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
 if(s->schema_reference)return 0;
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
 if(s->ledger_reading){fail(env,"ROOT_RESOURCE_LEDGER_READING");return NULL;}
 if(!allow_closed){if(s->closed){fail(env,"ROOT_RESOURCE_SESSION_CLOSED");return NULL;}if(s->unknown||!current(s)){s->unknown=1;fail(env,"ROOT_RESOURCE_SESSION_UNCONFIRMED");return NULL;}}return s;
}
/* Birth is private to this original open, never inferred from empty contents. */
static int open_birth_file(int dir,const char *name,int *created){
 int fd=openat(dir,name,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
 if(fd>=0){*created=1;return fd;}
 if(errno!=EEXIST)return -1;
 return openat(dir,name,O_RDWR|O_CLOEXEC|O_NOFOLLOW);
}
#include "root-pool-ordinary-open.h"
static napi_value open_original(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 return open_original_kernel(env);
}
#include "root-main-session.h"
/* New positive facts from a Main-bound session require its original local
 * role lifetime. Metadata/negative settlement keep their existing session
 * health/member checks and cannot use this helper to revive an effect. */
static nr_session *effect_session(napi_env env,napi_value candidate){
 nr_session *s=session(env,candidate,1);if(!s)return NULL;
 if(s->ledger_reading){fail(env,"ROOT_RESOURCE_LEDGER_READING");return NULL;}
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
#include "root-pool-native-operations.h"
#define NR_RESERVATION_IMPLEMENTATION
#include "reservation-ops.h"
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
#include "model-sdk-bridge.h"
#include "root-pool-bootstrap.h"
#include "root-pool-ledger-reader.h"
#include "root-pool-ledger-source.h"
#include "fixture-physical-snapshot.h"
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
#include "root-io-component-fixture.h"

#endif

#endif
#ifdef NR_LEDGER_SOURCE_ADDON
#include "json-string-data.h"
#include "physical-history-data.h"
#include "process-intent-data.h"
#include "readonly-leaf-history.h"
#include "root-pool-schema-validation.h"
#include "root-pool-graph-validation.h"
#include "root-pool-ledger-reader.h"
#include "root-pool-ledger-source.h"
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
#ifdef NR_LEDGER_SOURCE_ADDON
#include "root-ledger-source-addon-exports.h"
#else
#include "root-resource-addon-exports.h"
#endif
