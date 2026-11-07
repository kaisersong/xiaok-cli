/* Three original class-specific primitive boundaries. No object/JSON importer
 * or caller verifier. The exact TS accepted owner remains a separate AND. */
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
static napi_value nr_import_business_subject(napi_env env,napi_callback_info info,int key_kind){
    const int id_count=key_kind==NR_ROOM_PROJECT_KEY?5:key_kind==NR_WORKFLOW_ROOT_KEY?4:3;
    const int count=4+id_count+2;
    napi_value args[13],parent=NULL,out=NULL;
    if(!arguments(env,info,(size_t)count+1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
    nr_child *key=nr_source_key(env,args[0],key_kind);
    if(!key)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
    if(napi_get_reference_value(env,key->parent_ref,&parent)!=napi_ok||!parent)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
    nr_session *s=main_session_member(env,info,parent);
    if(!s)return NULL;
    if(!main_session_current(env,s))return NULL;
    if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
    char *values[11]={0},*q[11]={0};
    char *preimage=NULL,*metadata=NULL,subject_json[16384];
    char digest[65],payload_hash[65],execution_key[257];
    const int payload=4+id_count,authorization=payload+1;
    const char *execution_class=key_kind==NR_ROOM_PROJECT_KEY?"room_project":key_kind==NR_WORKFLOW_ROOT_KEY?"workflow_root":"kswarm_direct";
    int good=1,n=0;
    for(int i=0;i<count&&good;i++){
        values[i]=nr_subject_string(env,args[i+1],i==payload?1048576:256,i==payload);
        good=values[i]!=NULL;
        if(good&&i!=payload){q[i]=nr_json_string(values[i]);good=q[i]!=NULL;}
    }
    if(!good)goto invalid;
    if(key_kind==NR_WORKFLOW_ROOT_KEY){
        if(strlen(values[7])!=64)goto invalid;
        for(int i=0;i<64;i++)if(!((values[7][i]>='0'&&values[7][i]<='9')||(values[7][i]>='a'&&values[7][i]<='f')))goto invalid;
        n=snprintf(subject_json,sizeof(subject_json),"{\"kind\":\"workflow_root\",\"rootJobId\":%s,\"runId\":%s,\"scriptHash\":%s,\"workflowId\":%s}",q[5],q[6],q[7],q[4]);
    }else if(key_kind==NR_ROOM_PROJECT_KEY){
        n=snprintf(subject_json,sizeof(subject_json),"{\"claimId\":%s,\"kind\":\"room_project\",\"projectId\":%s,\"roomId\":%s,\"runId\":%s,\"taskId\":%s}",q[8],q[5],q[4],q[7],q[6]);
    }else{
        n=snprintf(subject_json,sizeof(subject_json),"{\"kind\":\"kswarm_task\",\"projectId\":%s,\"runId\":%s,\"taskId\":%s}",q[4],q[6],q[5]);
    }
    if(n<0||(size_t)n>=sizeof(subject_json)||!nr_hash(values[payload],payload_hash))goto unknown;
    const size_t capacity=32768;
    preimage=malloc(capacity);metadata=malloc(capacity);
    if(!preimage||!metadata)goto unknown;
    n=snprintf(preimage,capacity,"[\"root-execution-key-v2\",{\"hostId\":%s,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s},\"subject\":%s}]",q[3],q[2],q[0],q[1],subject_json);
    if(n<0||(size_t)n>=capacity||!nr_hash(preimage,digest))goto unknown;
    snprintf(execution_key,sizeof(execution_key),"nr2:%s",digest);
    n=snprintf(metadata,capacity,"{\"authorizationRef\":%s,\"executionClass\":\"%s\",\"executionKey\":\"%s\",\"hostId\":%s,\"payloadHash\":\"%s\",\"priorityClass\":\"background\",\"schemaVersion\":2,\"scope\":{\"principalId\":%s,\"profileId\":%s,\"workspaceId\":%s},\"subject\":%s}",q[authorization],execution_class,execution_key,q[3],payload_hash,q[2],q[0],q[1],subject_json);
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
    for(int i=0;i<count;i++){free(values[i]);free(q[i]);}
    free(preimage);free(metadata);return out;
}
static napi_value import_kswarm_task_subject(napi_env env,napi_callback_info info){return nr_import_business_subject(env,info,NR_KSWARM_DIRECT_KEY);}
static napi_value import_room_project_subject(napi_env env,napi_callback_info info){return nr_import_business_subject(env,info,NR_ROOM_PROJECT_KEY);}
static napi_value import_workflow_root_subject(napi_env env,napi_callback_info info){return nr_import_business_subject(env,info,NR_WORKFLOW_ROOT_KEY);}
#endif
