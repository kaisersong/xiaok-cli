/* Fixture-only history projection from the exact original connection.
 * No caller SQL/path, no permits and no resource state transitions. */
#if defined(NR_HAS_FIXTURE_FACTS) && defined(NR_MAIN_BOOTSTRAP_EMBEDDED)
static napi_value fixture_physical_snapshot(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s||!main_session_current(env,s))return NULL;
 sqlite3_stmt *query=NULL;const char *sql="SELECT record_id,resource_kind,execution_class,execution_key,metadata_digest,state FROM root_physical_resources ORDER BY resource_kind,enqueue_seq LIMIT 1025";
 int good=sqlite3_prepare_v2(s->db,sql,-1,&query,NULL)==SQLITE_OK,step=SQLITE_ERROR;
 napi_value out=object(env),rows;uint32_t count=0;
 good=good&&out&&napi_create_array(env,&rows)==napi_ok;
 const char *names[]={"recordId","resourceKind","executionClass","executionKey","metadataDigest","state"};
 while(good&&(step=sqlite3_step(query))==SQLITE_ROW){
  if(count>=1024){good=0;break;}
  napi_value row=object(env);good=row!=NULL;
  for(int column=0;good&&column<6;column++){
   if(column==1){int value=sqlite3_column_int(query,column);good=sqlite3_column_type(query,column)==SQLITE_INTEGER&&(value==1||value==2)&&number(env,row,names[column],value);}
   else{const unsigned char *value=sqlite3_column_text(query,column);int bytes=sqlite3_column_bytes(query,column);
    good=sqlite3_column_type(query,column)==SQLITE_TEXT&&value&&bytes>0&&strlen((const char*)value)==(size_t)bytes&&text(env,row,names[column],(const char*)value);}
  }
  if(good)good=napi_object_freeze(env,row)==napi_ok&&napi_set_element(env,rows,count++,row)==napi_ok;
 }
 good=good&&step==SQLITE_DONE;if(query&&sqlite3_finalize(query)!=SQLITE_OK)good=0;
 if(!good)return fail(env,"ROOT_RESOURCE_FIXTURE_SNAPSHOT_UNCONFIRMED");
 if(!main_session_current(env,s))return NULL;
 if(!text(env,out,"kind","fixture_original_physical_history_v1")||!own_data(env,out,"rows",rows)||napi_object_freeze(env,rows)!=napi_ok||napi_object_freeze(env,out)!=napi_ok)return fail(env,"ROOT_RESOURCE_FIXTURE_SNAPSHOT_UNCONFIRMED");
 return out;
}
#endif
