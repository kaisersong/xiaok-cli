/* Fifth fixed class. A private key proves role/session/class only; the original
 * A/B accepted reader and true draft-send receipt remain separate AND gates. */
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
static napi_value import_dsh_subject(napi_env env,napi_callback_info info){
 napi_value args[11],parent=NULL,out=NULL;
 if(!arguments(env,info,10,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_child *key=nr_source_key(env,args[0],NR_DSH_DRAFT_KEY);
 if(!key)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 if(napi_get_reference_value(env,key->parent_ref,&parent)!=napi_ok||!parent)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 nr_session *s=main_session_member(env,info,parent);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 char *values[9]={0},*quoted[9]={0},*preimage=NULL,*metadata=NULL;
 char digest[65],payload_hash[65],execution_key[257];int good=1;
 for(size_t i=0;i<9&&good;i++){
  values[i]=nr_subject_string(env,args[i+1],i==7?1048576:256,i==7);
  good=values[i]!=NULL;
  if(good&&i!=7){quoted[i]=nr_json_string(values[i]);good=quoted[i]!=NULL;}
 }
 if(!good)goto invalid;
 if(!nr_hash(values[7],payload_hash))goto unknown;
 size_t capacity=32768;preimage=malloc(capacity);metadata=malloc(capacity);
 if(!preimage||!metadata)goto unknown;
 int n=snprintf(preimage,capacity,
  "[\"root-execution-key-v2\",{\"hostId\":%s,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s},\"subject\":{\"draftCommitKey\":%s,\"draftInvocationId\":%s,\"kind\":\"dsh_draft\",\"ownerWorkId\":%s}}]",
  quoted[3],quoted[2],quoted[0],quoted[1],quoted[6],quoted[5],quoted[4]);
 if(n<0||(size_t)n>=capacity||!nr_hash(preimage,digest))goto unknown;
 snprintf(execution_key,sizeof(execution_key),"nr2:%s",digest);
 n=snprintf(metadata,capacity,
  "{\"authorizationRef\":%s,\"executionClass\":\"dsh_draft\",\"executionKey\":\"%s\",\"hostId\":%s,\"payloadHash\":\"%s\",\"priorityClass\":\"background\",\"schemaVersion\":2,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s},\"subject\":{\"draftCommitKey\":%s,\"draftInvocationId\":%s,\"kind\":\"dsh_draft\",\"ownerWorkId\":%s}}",
  quoted[8],execution_key,quoted[3],payload_hash,quoted[2],quoted[0],quoted[1],quoted[6],quoted[5],quoted[4]);
 if(n<0||(size_t)n>=capacity)goto unknown;
 nr_child *subject=nr_new_child(env,parent,s,NR_SUBJECT,&out);
 if(!subject)goto unknown;
 memcpy(subject->record.key,execution_key,strlen(execution_key)+1);
 subject->record.metadata=metadata;metadata=NULL;
 if(!nr_hash(subject->record.metadata,subject->record.digest)||!main_session_current(env,s))goto unknown;
 subject->priority=0;subject->valid=1;goto done;
invalid:
 out=fail(env,"ROOT_RESOURCE_SUBJECT_DATA_INVALID");goto done;
unknown:
 out=nr_error(env,s,"ROOT_RESOURCE_SUBJECT_UNCONFIRMED",0,0,0);
done:
 for(size_t i=0;i<9;i++){free(values[i]);free(quoted[i]);}
 free(preimage);free(metadata);return out;
}
#endif
