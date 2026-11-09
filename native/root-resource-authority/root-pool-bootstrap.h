#include "root-pool-schema-validation.h"
#include "root-pool-graph-validation.h"
#include "root-pool-v7-validation.h"
#include "root-pool-migration.h"
#include "fixture-migration-physical-history.h"
static int nr_pool_restore_protected_binding(nr_session *s){
 if(!s->root_io)return 1;
 enum nr_root_adoption_kind kind;
 if(!nr_root_store_read_adoption_kind(s->root_io,&kind))return 0;
 enum nr_root_bind_mode mode=NR_RECOVER_COMMITTED;
 if(kind==NR_ROOT_ADOPTED_BINDING){
  nr_original_pool_history history;nr_root_store_identity target;
  if(!nr_root_store_claim_adopted(s->root_io,&s->io_claim)||
     !nr_root_store_read_adoption(s->root_io,s->io_claim,&history,&target)||
     !nr_io_identity_same(&s->io_identity,&target))return 0;
  mode=NR_ADOPTION_COMMITTED;
 }
 return nr_pool_bind_protected(s,mode);
}
static napi_value bootstrap_original_main_pool(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(s->bootstrap_attempted)return fail(env,"ROOT_RESOURCE_BOOTSTRAP_ALREADY_ATTEMPTED");
 s->bootstrap_attempted=1;
 sqlite3_int64 count=-1;
 if(!scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count))return nr_error(env,s,"ROOT_RESOURCE_BOOTSTRAP_UNCONFIRMED",0,0,0);
 if(count==0){
  napi_value installed=install_fresh(env,info);if(!installed)return NULL;
  if(s->root_io&&(!nr_pool_graph(env,s)||!nr_pool_bind_protected(s,NR_FRESH_COMMIT)))return nr_error(env,s,"ROOT_RESOURCE_INSTALLED_BINDING_UNCONFIRMED",0,0,1);
  napi_value out=NULL;if(napi_create_string_utf8(env,"fresh",NAPI_AUTO_LENGTH,&out)!=napi_ok||!main_session_current(env,s))return nr_error(env,s,"ROOT_RESOURCE_BOOTSTRAP_UNCONFIRMED",0,0,1);s->bootstrap_status=1;return out;
 }
 if(!floor_valid(s)){
  if(s->root_io&&floor_match(s,NR_PROFILE,NR_DIGEST,NR_GUARD,NR_SCHEMA_VERSION))return nr_pool_migrate_original_v7(env,s);
  if(floor_history_valid(s))return fail(env,"ROOT_RESOURCE_LEGACY_POOL_IDENTITY_UNCONFIRMED");
  return nr_error(env,s,"ROOT_RESOURCE_RESTORE_UNCONFIRMED",0,0,0);
 }
 int began=execute(s,"BEGIN IMMEDIATE"),good=began;
 if(good)good=!s->created_db&&!s->created_lock&&current(s)&&nr_pool_graph(env,s)&&main_session_current(env,s)&&current(s);
 if(good){good=execute(s,"COMMIT")&&sqlite3_get_autocommit(s->db)==1;if(!good)s->unknown=1;}
 else if(began&&!execute(s,"ROLLBACK"))s->unknown=1;
 if(!good||s->unknown||s->closed||!current(s))return nr_error(env,s,"ROOT_RESOURCE_RESTORE_UNCONFIRMED",0,0,0);
 if(!nr_pool_restore_protected_binding(s))return nr_error(env,s,"ROOT_RESOURCE_INSTALLED_BINDING_UNCONFIRMED",0,0,1);
 /* No historical eligible list or opaque token is imported. Old capacity and
  * queue rows remain unchanged. Only new original enqueues become eligible. */
 s->fresh_owner=1;napi_value out=NULL;
 if(napi_create_string_utf8(env,"restored",NAPI_AUTO_LENGTH,&out)!=napi_ok||!main_session_current(env,s))return nr_error(env,s,"ROOT_RESOURCE_RESTORE_UNCONFIRMED",0,0,1);
 s->bootstrap_status=2;return out;
}


/* Passive same-session bootstrap fact. No SQL, re-install or new capability. */
static napi_value read_original_main_pool_bootstrap(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(s->bootstrap_status!=1&&s->bootstrap_status!=2)return fail(env,"ROOT_RESOURCE_BOOTSTRAP_REQUIRED");
 int sealed=s->business_sealed;napi_value out=object(env);
 if(!out||!text(env,out,"kind","original_main_pool_bootstrap_v1")||!text(env,out,"bootstrap",s->bootstrap_status==1?"fresh":"restored")||
    !text(env,out,"profile",nr_profile(s))||!number(env,out,"schemaVersion",nr_schema_version(s))||!text(env,out,"semanticDigest",nr_digest(s))||
    !boolean(env,out,"businessSealed",sealed)||napi_object_freeze(env,out)!=napi_ok||!main_session_current(env,s)||s->business_sealed!=sealed)
  return nr_error(env,s,"ROOT_RESOURCE_BOOTSTRAP_UNCONFIRMED",0,0,0);
 return out;
}
/* Negative logical seal never revokes the shared Core environment or IO. */
static napi_value seal_original_main_root_business(napi_env env,napi_callback_info info){
 napi_value args[2],out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 s->business_sealed=1;
 if(napi_get_undefined(env,&out)!=napi_ok)return NULL;
 return out;
}

#ifdef NR_FIXTURE_BUILD
/* Closed finite faults after actual original writes/COMMIT. No caller SQL,
 * callbacks, result DTOs or production grant is supplied by this seam. */
static napi_value arm_pool_bootstrap_failure(napi_env env,napi_callback_info info){
 napi_value args[3],out;int32_t value=0;double exact=0;napi_valuetype type;
 if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;if(!main_session_current(env,s))return NULL;
 if(napi_typeof(env,args[1],&type)!=napi_ok||type!=napi_number||napi_get_value_int32(env,args[1],&value)!=napi_ok||napi_get_value_double(env,args[1],&exact)!=napi_ok||exact!=(double)value||value<1||value>6)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_INVALID");
 if(s->bootstrap_attempted||s->writing||s->fresh_owner||s->fixture_bootstrap_failure||!s->created_lock||!s->created_db)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_UNAVAILABLE");
 s->fixture_bootstrap_failure=value;napi_get_undefined(env,&out);return out;
}
#endif
