/* Fixed primitive boundary of the original Main room key. This creates data
 * identity, never authenticates a TS business owner or qualifies product N. */
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
static nr_child *nr_source_key(napi_env env,napi_value value,int kind){
 bool tagged=false;nr_child *candidate=NULL;napi_valuetype type;
 if(napi_typeof(env,value,&type)!=napi_ok||type!=napi_object||
    napi_check_object_type_tag(env,value,&nr_child_tag,&tagged)!=napi_ok||!tagged||
    napi_unwrap(env,value,(void**)&candidate)!=napi_ok)return NULL;
 for(nr_child *c=nr_children;c;c=c->next)
  if(c==candidate)return c->env==env&&c->kind==kind&&c->valid&&owns(env,c->parent)?c:NULL;
 return NULL;
}
/* Validate original UTF-16 before NAPI UTF-8 conversion: lone surrogates must
 * not collide with an actual U+FFFD identity. No JS coercion/normalization. */
static char *nr_subject_string(napi_env env,napi_value value,size_t maximum_units,int payload){
 napi_valuetype type;size_t count=0,read=0,bytes=0;
 if(napi_typeof(env,value,&type)!=napi_ok||type!=napi_string||
    napi_get_value_string_utf16(env,value,NULL,0,&count)!=napi_ok||!count||count>maximum_units)return NULL;
 char16_t *units=malloc((count+1)*sizeof(*units));if(!units)return NULL;
 int good=napi_get_value_string_utf16(env,value,units,count+1,&read)==napi_ok&&read==count;
 for(size_t i=0;good&&i<count;i++){
  unsigned u=units[i];
  if(u==0||(!payload&&(u<32||u==127)))good=0;
  else if(u>=0xd800&&u<=0xdbff){if(i+1>=count||units[i+1]<0xdc00||units[i+1]>0xdfff)good=0;else i++;}
  else if(u>=0xdc00&&u<=0xdfff)good=0;
 }
 free(units);
 if(!good||napi_get_value_string_utf8(env,value,NULL,0,&bytes)!=napi_ok||bytes>1048576)return NULL;
 char *out=malloc(bytes+1);if(!out)return NULL;
 if(napi_get_value_string_utf8(env,value,out,bytes+1,&read)!=napi_ok||read!=bytes||memchr(out,0,bytes)){free(out);return NULL;}
 out[bytes]=0;return out;
}
#include "json-string-data.h"
static napi_value import_room_subject(napi_env env,napi_callback_info info){
 napi_value args[12],parent=NULL,out=NULL;
 if(!arguments(env,info,11,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 /* Native membership is prior to reading any primitive argument or role SDK. */
 nr_child *key=nr_source_key(env,args[0],NR_ROOM_DISCUSSION_KEY);
 if(!key)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 if(napi_get_reference_value(env,key->parent_ref,&parent)!=napi_ok||!parent)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 nr_session *s=main_session_member(env,info,parent);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 char *values[10]={0},*quoted[10]={0};char *preimage=NULL,*metadata=NULL;
 char digest[65],payload_hash[65],execution_key[257];int good=1;
 for(size_t i=0;i<10&&good;i++){
  values[i]=nr_subject_string(env,args[i+1],i==8?1048576:256,i==8);
  good=values[i]!=NULL;
  if(good&&i!=8){quoted[i]=nr_json_string(values[i]);good=quoted[i]!=NULL;}
 }
 if(!good)goto invalid;
 if(!nr_hash(values[8],payload_hash))goto unknown;
 /* All referenced strings are bounded above; no format input is caller data. */
 size_t capacity=32768;
 preimage=malloc(capacity);metadata=malloc(capacity);
 if(!preimage||!metadata)goto unknown;
 int n=snprintf(preimage,capacity,
  "[\"root-execution-key-v2\",{\"hostId\":%s,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s},\"subject\":{\"kind\":\"room_turn\",\"logicalAgentId\":%s,\"messageId\":%s,\"roomId\":%s,\"turnId\":%s}}]",
  quoted[3],quoted[2],quoted[0],quoted[1],quoted[6],quoted[5],quoted[4],quoted[7]);
 if(n<0||(size_t)n>=capacity||!nr_hash(preimage,digest))goto unknown;
 snprintf(execution_key,sizeof(execution_key),"nr2:%s",digest);
 n=snprintf(metadata,capacity,
  "{\"authorizationRef\":%s,\"executionClass\":\"room_discussion\",\"executionKey\":\"%s\",\"hostId\":%s,\"payloadHash\":\"%s\",\"priorityClass\":\"background\",\"schemaVersion\":2,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s},\"subject\":{\"kind\":\"room_turn\",\"logicalAgentId\":%s,\"messageId\":%s,\"roomId\":%s,\"turnId\":%s}}",
  quoted[9],execution_key,quoted[3],payload_hash,quoted[2],quoted[0],quoted[1],quoted[6],quoted[5],quoted[4],quoted[7]);
 if(n<0||(size_t)n>=capacity)goto unknown;
 nr_child *subject=nr_new_child(env,parent,s,NR_SUBJECT,&out);
 if(!subject)goto unknown;
 memcpy(subject->record.key,execution_key,strlen(execution_key)+1);
 subject->record.metadata=metadata;metadata=NULL;
 if(!nr_hash(subject->record.metadata,subject->record.digest)||!main_session_current(env,s))goto unknown;
 subject->priority=0;subject->valid=1;
 goto done;
invalid:
 out=fail(env,"ROOT_RESOURCE_SUBJECT_DATA_INVALID");goto done;
unknown:
 out=nr_error(env,s,"ROOT_RESOURCE_SUBJECT_UNCONFIRMED",0,0,0);
done:
 for(size_t i=0;i<10;i++){free(values[i]);free(quoted[i]);}
 free(preimage);free(metadata);return out;
}
#endif
