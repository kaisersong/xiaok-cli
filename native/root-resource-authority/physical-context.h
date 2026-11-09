/* Original Main business-context import; distinct from SQL history. */
static nr_child *nr_any_source_key(napi_env env,napi_value value){
 for(int kind=NR_ROOM_DISCUSSION_KEY;kind<=NR_CANVAS_KEY;kind++){
  nr_child *key=nr_source_key(env,value,kind);if(key)return key;
 }
 return NULL;
}
static napi_value import_physical_context(napi_env env,napi_callback_info info){
 napi_value args[8],parent=NULL,out=NULL,null_value;bool none=false;
 if(!arguments(env,info,7,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_child *key=nr_any_source_key(env,args[0]);if(!key)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 if(napi_get_reference_value(env,key->parent_ref,&parent)!=napi_ok||!parent)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 nr_session *s=main_session_member(env,info,parent);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 if(napi_get_null(env,&null_value)!=napi_ok||napi_strict_equals(env,args[1],null_value,&none)!=napi_ok)return nr_error(env,s,"ROOT_RESOURCE_CONTEXT_UNCONFIRMED",0,0,0);
 nr_child *ancestor=NULL;
 if(!none){ancestor=nr_get_child(env,args[1],s,NR_RESERVATION);if(!ancestor)ancestor=nr_get_child(env,args[1],s,NR_CONTEXT);if(!ancestor)return fail(env,"ROOT_RESOURCE_CONTEXT_PARENT_REQUIRED");}
 if((key->kind<=NR_DSH_DRAFT_KEY||key->kind==NR_NESTED_KEY||key->kind==NR_TOOL_KEY)&&!ancestor)return fail(env,"ROOT_RESOURCE_CONTEXT_PARENT_REQUIRED");
 if(ancestor&&ancestor->kind==NR_RESERVATION){
  nr_record row={0};int found=nr_read(s,ancestor->record.key,&row);
  int good=found==1&&nr_binding(&row,&ancestor->record)&&row.outbox==1&&nr_active(row.state);nr_record_clear(&row);
  if(!good)return fail(env,"ROOT_RESOURCE_CONTEXT_PARENT_REQUIRED");
 }
 char *values[5]={0},*q[5]={0},json[16384],hash[65];int good=1;
 for(int i=0;i<5&&good;i++){values[i]=nr_subject_string(env,args[i+2],256,0);good=values[i]!=NULL;if(good){q[i]=nr_json_string(values[i]);good=q[i]!=NULL;}}
 if(!good){out=fail(env,"ROOT_RESOURCE_CONTEXT_DATA_INVALID");goto done;}
 const char *root_id=ancestor?(ancestor->kind==NR_RESERVATION?ancestor->record.id:ancestor->record.claim):"";
 char root_json[520];if(root_id[0])snprintf(root_json,sizeof(root_json),"\"%s\"",root_id);else snprintf(root_json,sizeof(root_json),"null");
 int n=snprintf(json,sizeof(json),"{\"executionClass\":\"%s\",\"executionRef\":%s,\"hostId\":%s,\"nativeRootId\":%s,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s}}",nr_execution_classes[key->kind-4],q[4],q[3],root_json,q[2],q[0],q[1]);
 if(n<0||(size_t)n>=sizeof(json)||!nr_hash(json,hash)){out=nr_error(env,s,"ROOT_RESOURCE_CONTEXT_UNCONFIRMED",0,0,0);goto done;}
 nr_child *context=nr_new_child(env,parent,s,NR_CONTEXT,&out);
 if(!context){out=nr_error(env,s,"ROOT_RESOURCE_CONTEXT_UNCONFIRMED",0,0,0);goto done;}
 snprintf(context->record.key,sizeof(context->record.key),"context:%s",hash);context->record.metadata=strdup(json);context->source_kind=key->kind;
 if(ancestor)snprintf(context->record.claim,sizeof(context->record.claim),"%s",ancestor->kind==NR_RESERVATION?ancestor->record.id:ancestor->record.claim);
 if(!context->record.metadata||ancestor&&napi_create_reference(env,args[1],1,&context->source_ref)!=napi_ok||!main_session_current(env,s)){out=nr_error(env,s,"ROOT_RESOURCE_CONTEXT_UNCONFIRMED",0,0,0);goto done;}
 context->valid=1;
done:
 for(int i=0;i<5;i++){free(values[i]);free(q[i]);}return out;
}
