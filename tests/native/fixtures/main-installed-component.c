#include <node_api.h>
#include <stdlib.h>
#include "main-session-bridge.h"
typedef struct component_addon {
  napi_env env;
  nr_main_bridge *bridge;
  napi_ref captured_adopt;
} component_addon;
static napi_value error(napi_env env,const char *code){napi_throw_error(env,code,code);return NULL;}
static void cleanup(void *raw){
  component_addon *row=raw;
  nr_main_bridge_env_close(row->bridge);
  nr_main_bridge_release(row->bridge);
  napi_delete_reference(row->env,row->captured_adopt);
  free(row);
}
static napi_value probe(napi_env env,napi_callback_info info){
  napi_value input[2],fn,receiver,result;size_t count=2;void *data=NULL;
  if(napi_get_cb_info(env,info,&count,input,NULL,&data)!=napi_ok||count!=1||!data)return error(env,"COMPONENT_ARGUMENTS");
  component_addon *row=data;
  if(env!=row->env||napi_get_reference_value(env,row->captured_adopt,&fn)!=napi_ok||
     napi_get_undefined(env,&receiver)!=napi_ok)return error(env,"COMPONENT_CAPTURE_FAILED");
  uint64_t call=0;
  if(nr_main_bridge_adoption_enter(row->bridge,env,row,&call)!=NR_MAIN_OK)return error(env,"COMPONENT_ENTER_FAILED");
  napi_status status=napi_call_function(env,receiver,fn,1,input,&result);
  nr_main_result left=nr_main_bridge_adoption_leave(row->bridge,env,row,call);
  if(status!=napi_ok)return NULL;
  if(left!=NR_MAIN_OK)return error(env,"COMPONENT_LEAVE_FAILED");
  return result;
}
static int capture_failure(component_addon *row,napi_value input,napi_value *out){
  napi_value fn,receiver,result;
  if(napi_get_reference_value(row->env,row->captured_adopt,&fn)!=napi_ok||napi_get_undefined(row->env,&receiver)!=napi_ok)return 0;
  if(napi_call_function(row->env,receiver,fn,1,&input,&result)==napi_ok)return 0;
  return napi_get_and_clear_last_exception(row->env,out)==napi_ok;
}
static napi_value slot_checks(napi_env env,napi_callback_info info){
  napi_value input[2],out,first,after_taken,after_leave,next,value;size_t count=2;void *data=NULL;
  if(napi_get_cb_info(env,info,&count,input,NULL,&data)!=napi_ok||count!=1||!data)return error(env,"COMPONENT_ARGUMENTS");
  component_addon *row=data;uint64_t call=0,second=0;
  if(nr_main_bridge_adoption_enter(row->bridge,env,row,&call)!=NR_MAIN_OK)return error(env,"COMPONENT_ENTER_FAILED");
  int reentry=nr_main_bridge_adoption_enter(row->bridge,env,row,&second)!=NR_MAIN_OK;
  int wrong_leave=nr_main_bridge_adoption_leave(row->bridge,env,row,call+1)!=NR_MAIN_OK;
  int wrong_cookie=nr_main_bridge_adoption_leave(row->bridge,env,&call,call)!=NR_MAIN_OK;
  int good=capture_failure(row,input[0],&first)&&capture_failure(row,input[0],&after_taken);
  nr_main_result left=nr_main_bridge_adoption_leave(row->bridge,env,row,call);
  good=good&&left==NR_MAIN_OK&&capture_failure(row,input[0],&after_leave);
  if(!good)return error(env,"COMPONENT_CALL_CLEANUP_FAILED");
  if(nr_main_bridge_adoption_enter(row->bridge,env,row,&second)!=NR_MAIN_OK)return error(env,"COMPONENT_NEXT_ENTER_FAILED");
  good=capture_failure(row,input[0],&next);
  left=nr_main_bridge_adoption_leave(row->bridge,env,row,second);
  if(!good||left!=NR_MAIN_OK)return error(env,"COMPONENT_NEXT_CLEANUP_FAILED");
  if(napi_create_object(env,&out)!=napi_ok)return error(env,"COMPONENT_RESULT_FAILED");
  napi_get_boolean(env,reentry,&value);napi_set_named_property(env,out,"reentryRejected",value);
  napi_get_boolean(env,wrong_leave&&wrong_cookie,&value);napi_set_named_property(env,out,"foreignLeaveRejected",value);
  napi_set_named_property(env,out,"first",first);napi_set_named_property(env,out,"afterTaken",after_taken);
  napi_set_named_property(env,out,"afterLeave",after_leave);napi_set_named_property(env,out,"next",next);
  return out;
}
napi_value nr_init_resource_authority(napi_env env,napi_value exports){
  component_addon *row=calloc(1,sizeof(*row));if(!row)return error(env,"COMPONENT_ALLOCATION");
  row->env=env;napi_value fn;
  if(napi_get_named_property(env,exports,"__originalMainInstallationAdopt",&fn)!=napi_ok||
     napi_create_reference(env,fn,1,&row->captured_adopt)!=napi_ok){free(row);return error(env,"COMPONENT_CAPTURE_FAILED");}
  row->bridge=nr_main_bridge_create(env,row);
  if(!row->bridge){napi_delete_reference(env,row->captured_adopt);free(row);return error(env,"COMPONENT_BRIDGE_FAILED");}
  if(napi_add_env_cleanup_hook(env,cleanup,row)!=napi_ok){cleanup(row);return error(env,"COMPONENT_CLEANUP_FAILED");}
  const napi_property_descriptor methods[]={
    {"componentAdopt",NULL,probe,NULL,NULL,NULL,napi_default,row},
    {"componentSlotChecks",NULL,slot_checks,NULL,NULL,NULL,napi_default,row}};
  if(napi_define_properties(env,exports,2,methods)!=napi_ok)return error(env,"COMPONENT_EXPORT_FAILED");
  return exports;
}
