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
 s->directory=s->lock_fd=-1;s->birth_pid=getpid();s->owner_env=env;s->main_bridge=addon->bridge;s->main_cookie=addon;
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
