#include <node_api.h>
#include "kswarm-child-launch.h"
#include "protected-sqlite-facade.h"
/* Fixed bootstrap producer. No JS input selects path, family, scope or client. */
static nm_installed_client *client;
static nr_root_store_io *io;
static napi_env original_env;
static napi_ref original;
static int entered,failed;
static napi_value error(napi_env env,const char *message){napi_throw_error(env,"KSWARM_ORIGINAL_AUTHORITY_REQUIRED",message);return NULL;}
static int no_arguments(napi_env env,napi_callback_info info){size_t argc=1;napi_value ignored[1];return napi_get_cb_info(env,info,&argc,ignored,NULL,NULL)==napi_ok&&!argc;}
static napi_value consume(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||failed||(original_env&&original_env!=env))return error(env,"original fixed birth required");
 if(original){napi_value result;if(napi_get_reference_value(env,original,&result)!=napi_ok)return NULL;return result;}
 if(!ps_sqlite_api_available()){napi_throw_error(env,"KSWARM_ORIGINAL_API_UNAVAILABLE","protected SQLite requires macOS 12.3 or newer");return NULL;}
 if(entered)return error(env,"original birth is one use");entered=1;original_env=env;client=nm_installed_create();
 nr_root_store_identity identity;const nr_root_bootstrap_claim *claim=NULL;
 if(!client||!nm_installed_connect_kswarm_child(client,&io)||!nr_root_store_read_identity(io,&identity)||(identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity)))){failed=1;return error(env,"original child IO birth unconfirmed");}
 napi_value result=ps_create_original_namespace(env,io);
 if(!result||napi_create_reference(env,result,1,&original)!=napi_ok){failed=1;return NULL;}return result;
}
static napi_value read_current(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||failed||(original_env&&original_env!=env))return error(env,"original fixed birth required");
 napi_value result;if(!original){napi_get_undefined(env,&result);return result;}
 if(napi_get_reference_value(env,original,&result)!=napi_ok)return NULL;return result;
}
static napi_value bind_current(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||failed||env!=original_env||!original||!nm_installed_current(client))return error(env,"original current child required");
 if(!nm_kswarm_child_bind_namespace_current(client)){failed=1;return error(env,"original namespace binding unconfirmed");}
 napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value finish(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||!entered||env!=original_env||!client)return error(env,"original child required");
 /* The original client predates namespace/ref publication. A failed positive
  * birth still owns its IO; negative cleanup must not depend on that ref. The
  * fixed release refuses busy/unknown IO, and neither failure nor birth resets. */
 int closed=1;
 if(failed&&io&&nr_root_store_release_owned(io)!=NR_SQL_FILES_CLOSED)closed=0;
 if(!nm_installed_close_owned(client))closed=0;
 if(!closed){failed=1;return error(env,"original negative close is held");}
 napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value initialize(napi_env env,napi_value exports){
 ps_addon_exports(env,exports);napi_property_descriptor methods[]={
 {.utf8name="consumeOriginalKSwarmSource",.method=consume},
 {.utf8name="readOriginalKSwarmSource",.method=read_current},
 {.utf8name="bindOriginalKSwarmNamespace",.method=bind_current},
 {.utf8name="finishOriginalKSwarmSource",.method=finish}};
 if(napi_define_properties(env,exports,4,methods)!=napi_ok)return NULL;
 const char *names[]={"assertOriginalNamespace","consumeOriginalKSwarmSource","readOriginalKSwarmSource","bindOriginalKSwarmNamespace","finishOriginalKSwarmSource"};
 for(size_t index=0;index<5;index++){napi_value fn;if(napi_get_named_property(env,exports,names[index],&fn)!=napi_ok||napi_object_freeze(env,fn)!=napi_ok)return NULL;}
 napi_object_freeze(env,exports);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
