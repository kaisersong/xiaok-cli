#include "process-intent-data.h"
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
