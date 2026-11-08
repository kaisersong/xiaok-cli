#include <node_api.h>
#include "broker-child-launch.h"
#include "protected-sqlite-facade.h"
/* Fixed Broker bootstrap only: Native owns the inherited family and scope. */
static nm_installed_client *client;
static nr_root_store_io *io;
static napi_env original_env;
static napi_ref original;
static int entered,failed;
static napi_value error(napi_env env,const char *message){napi_throw_error(env,"BROKER_ORIGINAL_AUTHORITY_REQUIRED",message);return NULL;}
static int no_arguments(napi_env env,napi_callback_info info){size_t argc=1;napi_value ignored[1];return napi_get_cb_info(env,info,&argc,ignored,NULL,NULL)==napi_ok&&!argc;}
static napi_value failed_birth(napi_env env,const char *message){
 failed=1;
 /* Native negative cleanup remains reachable even before publishing a JS ref.
  * The client retains unknown/error facts; never free an unconfirmed resource. */
 if(io)(void)nr_root_store_release_owned(io);
 if(client)(void)nm_installed_close_owned(client);
 bool pending=false;if(napi_is_exception_pending(env,&pending)!=napi_ok||pending)return NULL;
 return error(env,message);
}
static napi_value consume(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||failed||(original_env&&original_env!=env))return error(env,"original fixed birth required");
 if(original){napi_value result;if(napi_get_reference_value(env,original,&result)!=napi_ok)return NULL;return result;}
 if(entered)return error(env,"original birth is one use");entered=1;original_env=env;client=nm_installed_create();
 nr_root_store_identity identity;const nr_root_bootstrap_claim *claim=NULL;
 if(!client||!nm_installed_connect_broker_child(client,&io)||!nr_root_store_read_identity(io,&identity)||(identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity))))return failed_birth(env,"original child IO birth unconfirmed");
 napi_value result=ps_create_original_namespace(env,io);
 if(!result||napi_create_reference(env,result,1,&original)!=napi_ok)return failed_birth(env,"original namespace reference unconfirmed");
 return result;
}
static napi_value read_current(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||failed||(original_env&&original_env!=env))return error(env,"original fixed birth required");
 napi_value result;if(!original){napi_get_undefined(env,&result);return result;}
 if(napi_get_reference_value(env,original,&result)!=napi_ok)return NULL;return result;
}
static napi_value bind_current(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||failed||env!=original_env||!original||!nm_installed_current(client))return error(env,"original current child required");
 if(!nm_broker_child_bind_namespace_current(client)){failed=1;return error(env,"original namespace binding unconfirmed");}
 napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value finish(napi_env env,napi_callback_info info){
 if(!no_arguments(env,info)||!entered||env!=original_env||!client)return error(env,"original entered child required");
 int closed=1;
 if(failed&&io&&nr_root_store_release_owned(io)!=NR_SQL_FILES_CLOSED)closed=0;
 if(!nm_installed_close_owned(client))closed=0;
 if(!closed){failed=1;return error(env,"original negative close is held");}
 napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value initialize(napi_env env,napi_value exports){
 ps_addon_exports(env,exports);napi_property_descriptor methods[]={
 {.utf8name="consumeOriginalBrokerSource",.method=consume},
 {.utf8name="readOriginalBrokerSource",.method=read_current},
 {.utf8name="bindOriginalBrokerNamespace",.method=bind_current},
 {.utf8name="finishOriginalBrokerSource",.method=finish}};
 if(napi_define_properties(env,exports,4,methods)!=napi_ok)return NULL;
 const char *names[]={"assertOriginalNamespace","consumeOriginalBrokerSource","readOriginalBrokerSource","bindOriginalBrokerNamespace","finishOriginalBrokerSource"};
 for(size_t index=0;index<5;index++){napi_value fn;if(napi_get_named_property(env,exports,names[index],&fn)!=napi_ok||napi_object_freeze(env,fn)!=napi_ok)return NULL;}
 napi_object_freeze(env,exports);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
