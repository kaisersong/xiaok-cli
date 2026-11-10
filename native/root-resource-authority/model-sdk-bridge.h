/* Main-only opaque binding of one fixed physical SDK port. This auxiliary
 * key is not an execution class, business authorization, or P4 qualification. */
static int model_sdk_nonproxy_candidate(napi_env env,napi_callback_info info,napi_value value){
 nr_main_addon *addon=main_addon(env,info);napi_value shape,result,input[2];bool accepted=false;
 if(!addon||!addon->model_sdk_shape||napi_get_reference_value(env,addon->model_sdk_shape,&shape)!=napi_ok)return 0;
 input[0]=value;if(napi_get_boolean(env,true,input+1)!=napi_ok||
    napi_call_function(env,value,shape,2,input,&result)!=napi_ok)return 0;
 return napi_get_value_bool(env,result,&accepted)==napi_ok&&accepted;
}
static napi_value take_model_sdk_bridge_key(napi_env env,napi_callback_info info){
 napi_value args[3],shape,result,out=NULL;bool accepted=false;
 if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 if(!model_sdk_nonproxy_candidate(env,info,args[0]))return fail(env,"ROOT_RESOURCE_MAIN_ISSUER_REQUIRED");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(s->source_key_slots&16384u)return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_ALREADY_ATTEMPTED");
 nr_main_addon *addon=main_addon(env,info);
 if(!addon||!addon->model_sdk_shape||
    napi_get_reference_value(env,addon->model_sdk_shape,&shape)!=napi_ok||
    napi_call_function(env,args[0],shape,1,args+1,&result)!=napi_ok)return NULL;
 if(napi_get_value_bool(env,result,&accepted)!=napi_ok||!accepted)
  return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_PORT_REQUIRED");
 if(!main_session_current(env,s))return NULL;
 /* Sticky before allocating or entering another Native operation. A failed
  * key construction cannot reopen installation on this issuer. */
 s->source_key_slots|=16384u;
 nr_child *key=nr_new_child(env,args[0],s,NR_MODEL_SDK_BRIDGE,&out);
 if(!key||napi_create_reference(env,args[1],1,&key->source_ref)!=napi_ok)
  return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_UNCONFIRMED");
 key->valid=1;return out;
}
static napi_value assert_model_sdk_bridge(napi_env env,napi_callback_info info){
 napi_value args[3],parent,port,out;bool same=false;
 if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 /* No candidate property, role SDK, or Proxy trap precedes membership. */
 if(!model_sdk_nonproxy_candidate(env,info,args[0]))return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_KEY_REQUIRED");
 nr_child *key=nr_source_key(env,args[0],NR_MODEL_SDK_BRIDGE);
 if(!key||!key->source_ref)return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_KEY_REQUIRED");
 if(napi_get_reference_value(env,key->source_ref,&port)!=napi_ok||!port||
    napi_strict_equals(env,port,args[1],&same)!=napi_ok||!same)
  return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_PORT_REQUIRED");
 if(napi_get_reference_value(env,key->parent_ref,&parent)!=napi_ok||!parent)
  return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_KEY_REQUIRED");
 nr_session *s=main_session_member(env,info,parent);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 napi_get_undefined(env,&out);return out;
}
