/* Original P claim intent. This is durable launch identity, not permission to
 * launch again, OS containment, a liveness proof, or a terminal certificate. */
static int nr_intent_text(const nr_cell *cell){
 return cell->type==SQLITE_TEXT&&cell->bytes&&cell->length>0&&
        (size_t)cell->length==strlen((const char*)cell->bytes);
}
static int nr_intent_nonce(const char *value){
 if(strlen(value)!=64)return 0;
 for(int i=0;i<64;i++)if(!((value[i]>='0'&&value[i]<='9')||(value[i]>='a'&&value[i]<='f')))return 0;
 return 1;
}
static int nr_process_intent(nr_session *s,const nr_cell *row,const char *nonce,nr_cell *receipt){
 const int strings[]={0,2,3,4,5,8};
 for(size_t i=0;i<sizeof(strings)/sizeof(*strings);i++)if(!nr_intent_text(row+strings[i]))return 0;
 if(row[1].type!=SQLITE_INTEGER||row[1].integer!=2||nr_role(row,"workflow_child_slot")||
    row[9].type!=SQLITE_INTEGER||row[9].integer<1||row[9].integer>NR_MAX_SAFE||
    row[10].type!=SQLITE_INTEGER||row[10].integer<1||row[10].integer>NR_MAX_SAFE||
    !nr_intent_nonce(nonce)||!nr_intent_nonce((const char*)row[8].bytes)||
    !strcmp(nonce,(const char*)row[8].bytes))return 0;
 char invocation[257],spec[65];sqlite3_stmt *stmt=NULL;
 int good=sqlite3_prepare_v2(s->db,"SELECT json_extract(?1,'$.attemptId'),json_extract(?1,'$.bodyHash'),json_extract(?1,'$.resourceKind')",-1,&stmt,NULL)==SQLITE_OK&&
  nr_bind(stmt,1,row+4)&&sqlite3_step(stmt)==SQLITE_ROW&&
  nr_string_column(stmt,0,invocation,sizeof(invocation),0)&&nr_string_column(stmt,1,spec,sizeof(spec),0)&&nr_intent_nonce(spec)&&
  sqlite3_column_type(stmt,2)==SQLITE_TEXT&&sqlite3_column_bytes(stmt,2)==7&&!memcmp(sqlite3_column_text(stmt,2),"process",7)&&sqlite3_step(stmt)==SQLITE_DONE;
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 if(!good)return 0;
 const char *values[]={(const char*)row[0].bytes,(const char*)row[3].bytes,(const char*)row[2].bytes,(const char*)row[5].bytes,(const char*)row[8].bytes,nonce,invocation,spec};
 char *quoted[8]={0},json[8192],hash[65];
 for(int i=0;i<8&&good;i++){quoted[i]=nr_json_string(values[i]);good=quoted[i]!=NULL;}
 if(good){
  int n=snprintf(json,sizeof(json),"{\"schemaVersion\":1,\"kind\":\"original_process_intent_v1\",\"recordId\":%s,\"executionKey\":%s,\"executionClass\":%s,\"metadataDigest\":%s,\"issuerEpoch\":%lld,\"acquireGeneration\":%lld,\"claimToken\":%s,\"launchNonce\":%s,\"invocationId\":%s,\"specHash\":%s,\"launchStage\":\"claimed_unbound\"}",quoted[0],quoted[1],quoted[2],quoted[3],(long long)row[10].integer,(long long)row[9].integer,quoted[4],quoted[5],quoted[6],quoted[7]);
  good=n>0&&(size_t)n<sizeof(json)&&nr_hash(json,hash)&&nr_text(receipt,values[0])&&nr_text(receipt+1,"process_intent_v1")&&nr_text(receipt+2,hash)&&nr_text(receipt+3,json);
 }
 for(int i=0;i<8;i++)free(quoted[i]);return good;
}
static int nr_read_process_intent(nr_session *s,const nr_cell *row,nr_cell *receipt,const char *expected_nonce){
 sqlite3_stmt *stmt=NULL;char nonce[65];int good=sqlite3_prepare_v2(s->db,"SELECT binding_hash,receipt_json,json_extract(receipt_json,'$.launchNonce') FROM root_physical_receipts WHERE record_id=? AND kind='process_intent_v1'",-1,&stmt,NULL)==SQLITE_OK&&nr_bind(stmt,1,row)&&sqlite3_step(stmt)==SQLITE_ROW;
 if(good)good=nr_string_column(stmt,2,nonce,sizeof(nonce),0)&&(!expected_nonce||!strcmp(expected_nonce,nonce))&&nr_process_intent(s,row,nonce,receipt)&&
  nr_column_equal(receipt+2,stmt,0)&&nr_column_equal(receipt+3,stmt,1)&&sqlite3_step(stmt)==SQLITE_DONE;
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;return good;
}
static napi_value nr_project_process_intent(napi_env env,nr_session *s,const nr_cell *row,const nr_cell *receipt){
 /* Project through SQLite's fixed JSON paths, never a JS parser/prototype. */
 static const char *names[]={"recordId","executionKey","executionClass","metadataDigest","issuerEpoch","acquireGeneration","claimToken","launchNonce","invocationId","specHash"};
 sqlite3_stmt *stmt=NULL;napi_value out=object(env),intent=object(env);
 int good=out&&intent&&sqlite3_prepare_v2(s->db,"SELECT json_extract(?1,'$.recordId'),json_extract(?1,'$.executionKey'),json_extract(?1,'$.executionClass'),json_extract(?1,'$.metadataDigest'),json_extract(?1,'$.issuerEpoch'),json_extract(?1,'$.acquireGeneration'),json_extract(?1,'$.claimToken'),json_extract(?1,'$.launchNonce'),json_extract(?1,'$.invocationId'),json_extract(?1,'$.specHash')",-1,&stmt,NULL)==SQLITE_OK&&nr_bind(stmt,1,receipt+3)&&sqlite3_step(stmt)==SQLITE_ROW;
 for(int i=0;i<10&&good;i++)good=i==4||i==5?number(env,intent,names[i],sqlite3_column_int64(stmt,i)):text(env,intent,names[i],(const char*)sqlite3_column_text(stmt,i));
 good=good&&number(env,intent,"schemaVersion",1)&&text(env,intent,"kind","original_process_intent_v1")&&text(env,intent,"launchStage","claimed_unbound")&&nr_physical_project(env,out,row)&&own_data(env,out,"intent",intent);
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 good=good&&nr_leaf_history(env,s,row,out);
 return good?out:NULL;
}
static napi_value read_process_intent(napi_env env,napi_callback_info info,int history){
 napi_value args[3];if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],0);if(!s)return NULL;
 nr_child *permit=NULL;char key[257];
 if(history){if(!nr_key(env,args[1],key))return fail(env,"ROOT_RESOURCE_KEY_REQUIRED");}
 else{permit=nr_get_child(env,args[1],s,NR_PROCESS_PERMIT);if(!permit)return fail(env,"ROOT_RESOURCE_PHYSICAL_PERMIT_REQUIRED");snprintf(key,sizeof(key),"%s",permit->record.key);}
 nr_cell row[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};napi_value out=NULL;
 if(!(history?floor_history_valid(s):floor_valid(s)))goto bad;
 int found=nr_physical_row(s,2,key,row);if(found<0)goto bad;
 if(!found){if(permit)goto bad;out=nr_null(env);goto done;}
 if(history&&(nr_state(row,"queued")||nr_role(row,"workflow_child_slot"))){out=nr_null(env);goto done;}
 if(!nr_read_process_intent(s,row,receipt,permit?permit->record.attempt:NULL))goto bad;
 if(permit&&(strcmp((const char*)row[0].bytes,permit->record.id)||strcmp((const char*)row[5].bytes,permit->record.digest)||strcmp((const char*)row[8].bytes,permit->record.claim)||row[9].integer!=permit->record.generation||row[10].integer!=permit->record.epoch))goto bad;
 out=nr_project_process_intent(env,s,row,receipt);if(!out||s->closed||s->unknown||!current(s)||!(history?floor_history_valid(s):floor_valid(s))||!main_session_current(env,s))goto bad;goto done;
bad:
 out=nr_error(env,s,"ROOT_RESOURCE_PROCESS_INTENT_UNCONFIRMED",sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);
done:
 nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return out;
}
static napi_value read_original_process_intent(napi_env env,napi_callback_info info){return read_process_intent(env,info,0);}
static napi_value read_original_process_history(napi_env env,napi_callback_info info){return read_process_intent(env,info,1);}
#ifdef NR_HAS_FIXTURE_FACTS
static napi_value arm_process_intent_write_failure(napi_env env,napi_callback_info info){
 napi_value args[3],out;int32_t index=0;double exact=0;
 if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 napi_valuetype type;if(napi_typeof(env,args[1],&type)!=napi_ok||type!=napi_number||napi_get_value_int32(env,args[1],&index)!=napi_ok||napi_get_value_double(env,args[1],&exact)!=napi_ok||exact!=(double)index||index<1||index>6)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_INVALID");
 if(!s->fresh_owner||s->writing||s->fixture_process_write)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_UNAVAILABLE");
 s->fixture_process_write=index;napi_get_undefined(env,&out);return out;
}
#endif
static int nr_process_claim_write(nr_session *s,nr_write *write,int process){
 int good=nr_run_write(s,write);
#ifdef NR_HAS_FIXTURE_FACTS
 if(good&&process&&s->fixture_process_write>0&&!--s->fixture_process_write)return 0;
#else
 (void)process;
#endif
 return good;
}
