static int nr_pool_n(nr_session *s){
 nr_cell policy[NR_MAX_CELLS]={0};int good=nr_policy(s,policy)&&nr_intent_text(policy+1)&&!strcmp((const char*)policy[1].bytes,"native-reservation-component")&&nr_intent_text(policy+2)&&!strcmp((const char*)policy[2].bytes,"{\"build\":\"reservation-writer\"}")&&policy[6].integer<=3;
 sqlite3_stmt *q=NULL;int step=SQLITE_DONE;sqlite3_int64 rows=0,claimed=0;
 if(good)good=sqlite3_prepare_v2(s->db,nr_select_record,-1,&q,NULL)==SQLITE_OK;
 while(good&&(step=sqlite3_step(q))==SQLITE_ROW){nr_record r={0};good=nr_decode_record(q,&r)&&nr_intent_nonce(r.id)&&nr_pool_metadata(s,&r);rows++;
  int cancelled=!strcmp(r.state,"cancelled_before_launch"),released=!strcmp(r.state,"released"),queued=!strcmp(r.state,"queued");char json[1800];sqlite3_int64 expected=0;
  if(good&&queued)good=r.revision==1;
  if(good&&cancelled){snprintf(json,sizeof(json),"{\"acquireGeneration\":0,\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",r.digest,r.id);good=r.revision==2&&nr_pool_receipt(s,NR_RECEIPTS,r.id,"cancelled_before_launch",json);expected=1;}
  if(good&&!queued&&!cancelled){
   good=nr_intent_nonce(r.claim)&&nr_intent_nonce(r.attempt)&&r.revision==(released?3:2)&&(r.outbox==0||r.outbox==1);claimed++;
   sqlite3_stmt *c=NULL;sqlite3_int64 seq=0;
   if(good)good=sqlite3_prepare_v2(s->db,"SELECT json_extract(receipt_json,'$.claimSeq') FROM root_resource_receipts WHERE record_id=? AND kind='reserved'",-1,&c,NULL)==SQLITE_OK&&sqlite3_bind_text(c,1,r.id,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(c)==SQLITE_ROW&&sqlite3_column_type(c,0)==SQLITE_INTEGER;
   if(good){seq=sqlite3_column_int64(c,0);good=seq>=1&&seq<=policy[7].integer&&sqlite3_step(c)==SQLITE_DONE;}if(c&&sqlite3_finalize(c)!=SQLITE_OK)good=0;
   snprintf(json,sizeof(json),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimSeq\":%lld,\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",r.attempt,(long long)seq,r.claim,r.digest,r.id);good=good&&nr_pool_receipt(s,NR_RECEIPTS,r.id,"reserved",json);expected=1;
   if(good&&r.outbox==1){snprintf(json,sizeof(json),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",r.attempt,r.claim,r.digest,r.id);good=nr_pool_receipt(s,NR_RECEIPTS,r.id,"launch_consumed",json);expected++;}
   if(good&&released){snprintf(json,sizeof(json),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\",\"state\":\"released\"}",r.attempt,r.claim,r.digest,r.id);good=r.outbox==1&&nr_pool_receipt(s,NR_RECEIPTS,r.id,"physical_finished",json);expected++;}
  }
  sqlite3_stmt *c=NULL;if(good)good=sqlite3_prepare_v2(s->db,"SELECT count(*) FROM root_resource_receipts WHERE record_id=?",-1,&c,NULL)==SQLITE_OK&&sqlite3_bind_text(c,1,r.id,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(c)==SQLITE_ROW&&sqlite3_column_int64(c,0)==expected&&sqlite3_step(c)==SQLITE_DONE;if(c&&sqlite3_finalize(c)!=SQLITE_OK)good=0;nr_record_clear(&r);
 }
 if(good)good=step==SQLITE_DONE&&rows==policy[5].integer&&claimed==policy[7].integer;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 q=NULL;int burst=0;
 if(good)good=sqlite3_prepare_v2(s->db,"SELECT json_extract(r.metadata_json,'$.priorityClass') FROM root_resource_receipts x JOIN root_resources r USING(record_id) WHERE x.kind='reserved' ORDER BY json_extract(x.receipt_json,'$.claimSeq') DESC LIMIT 3",-1,&q,NULL)==SQLITE_OK;
 while(good&&(step=sqlite3_step(q))==SQLITE_ROW){if(nr_pool_text(q,0,"background"))break;if(!nr_pool_text(q,0,"human")){good=0;break;}burst++;}
 if(good)good=policy[6].integer==burst;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;nr_cells_clear(policy,NR_MAX_CELLS);
 return good&&nr_pool_zero(s,"SELECT count(*) FROM root_resources WHERE enqueue_seq<1 OR enqueue_seq>(SELECT next_seq FROM root_resource_policy)")&&nr_pool_zero(s,"SELECT count(*) FROM root_launch_outbox o JOIN root_resources r USING(record_id) WHERE typeof(o.revision)<>'integer' OR typeof(o.state)<>'text' OR o.state<>CASE o.revision WHEN 0 THEN 'pending' WHEN 1 THEN 'consumed' ELSE '' END")&&nr_pool_zero(s,"SELECT count(*)-count(DISTINCT json_extract(receipt_json,'$.claimSeq')) FROM root_resource_receipts WHERE kind='reserved'")&&nr_pool_zero(s,"SELECT CASE WHEN count(*)>5 THEN 1 ELSE 0 END FROM root_resources WHERE state IN ('reserved','running','cancel_pending','launch_unknown')")&&nr_pool_zero(s,"SELECT CASE WHEN count(*)>256 THEN 1 ELSE 0 END FROM root_resources WHERE state='queued'");
}
static int nr_pool_physical_metadata(nr_session *s,const nr_cell *r){
 char sql[4096];sqlite3_stmt *q=NULL;int slot=nr_role(r,"workflow_child_slot"),good=1;
 if(slot){
  snprintf(sql,sizeof(sql),"SELECT json_object('intent','workflow_child_capacity_v1','nativeRootId',?2,'vmRecordId',?3)");
  good=sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&nr_bind(q,2,r+13)&&nr_bind(q,3,r+12)&&sqlite3_step(q)==SQLITE_ROW&&nr_column_equal(r+4,q,0)&&sqlite3_step(q)==SQLITE_DONE;
  char key[96];snprintf(key,sizeof(key),"process-slot:%s",(const char*)r[12].bytes);good=good&&!strcmp((const char*)r[3].bytes,key)&&!strcmp((const char*)r[2].bytes,"workflow_root");
 }else{
  const char *context="json_object('executionClass',json_extract(?1,'$.context.executionClass'),'executionRef',json_extract(?1,'$.context.executionRef'),'hostId',json_extract(?1,'$.context.hostId'),'nativeRootId',json_extract(?1,'$.context.nativeRootId'),'scope',json_object('principalId',json_extract(?1,'$.context.scope.principalId'),'profileId',json_extract(?1,'$.context.scope.profileId'),'workspaceId',json_extract(?1,'$.context.scope.workspaceId')))";
  snprintf(sql,sizeof(sql),"SELECT json_object('attemptId',json_extract(?1,'$.attemptId'),'bodyHash',json_extract(?1,'$.bodyHash'),'context',json(%s),'resourceKind',?2),%s,json_extract(?1,'$.attemptId'),json_extract(?1,'$.bodyHash'),json_extract(?1,'$.context.executionClass'),json_extract(?1,'$.context.nativeRootId')",context,context);
  char attempt[257],body[65],cls[32],hash[65],identity[8192],key[80];
  good=sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&nr_bind(q,1,r+4)&&sqlite3_bind_text(q,2,r[1].integer==1?"model":"process",-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&nr_column_equal(r+4,q,0)&&sqlite3_column_type(q,1)==SQLITE_TEXT&&nr_string_column(q,2,attempt,sizeof(attempt),0)&&nr_string_column(q,3,body,sizeof(body),0)&&nr_intent_nonce(body)&&nr_string_column(q,4,cls,sizeof(cls),0)&&!strcmp(cls,(const char*)r[2].bytes)&&nr_column_equal(r+13,q,5)&&nr_hash((const char*)sqlite3_column_text(q,1),hash);
  if(good){int n=snprintf(identity,sizeof(identity),"%lld:context:%s:%s",(long long)r[1].integer,hash,attempt);good=n>0&&(size_t)n<sizeof(identity)&&nr_hash(identity,hash);snprintf(key,sizeof(key),"%s:%s",r[1].integer==1?"model":"process",hash);good=good&&!strcmp(key,(const char*)r[3].bytes)&&sqlite3_step(q)==SQLITE_DONE;}
 }
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 /* No numeric identity leaves, embedded NUL or unsupported classes. */
 if(good&&!slot){q=NULL;good=sqlite3_prepare_v2(s->db,"SELECT count(*) FROM json_tree(?1) WHERE (type NOT IN ('object','text','null')) OR (type='null' AND fullkey<>'$.context.nativeRootId') OR (type='text' AND (length(value)=0 OR instr(value,char(0))>0))",-1,&q,NULL)==SQLITE_OK&&nr_bind(q,1,r+4)&&sqlite3_step(q)==SQLITE_ROW&&sqlite3_column_int64(q,0)==0&&sqlite3_step(q)==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;}
 return good&&nr_pool_json_identities(s,(const char*)r[4].bytes);
}
static int nr_pool_physical(napi_env env,nr_session *s){
 sqlite3_stmt *q=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT resource_kind,execution_key FROM root_physical_resources ORDER BY resource_kind,enqueue_seq",-1,&q,NULL)==SQLITE_OK,step=SQLITE_DONE;
 sqlite3_int64 rows[2]={0},claims[2]={0};
 while(good&&(step=sqlite3_step(q))==SQLITE_ROW){
  nr_cell r[NR_MAX_CELLS]={0},fact[NR_MAX_CELLS]={0};char key[257];
  int kind=sqlite3_column_int(q,0);good=sqlite3_column_type(q,0)==SQLITE_INTEGER&&(kind==1||kind==2)&&nr_string_column(q,1,key,sizeof(key),0)&&nr_physical_row(s,kind,key,r)==1;
  const int strings[]={0,2,3,4,5,7,11};for(size_t i=0;i<sizeof(strings)/sizeof(*strings)&&good;i++)good=nr_intent_text(r+strings[i]);
  if(good)good=nr_intent_nonce((const char*)r[0].bytes)&&nr_intent_nonce((const char*)r[5].bytes)&&r[6].type==SQLITE_INTEGER&&r[6].integer==++rows[kind-1]&&r[9].type==SQLITE_INTEGER&&r[9].integer>=0&&r[9].integer<=NR_MAX_SAFE&&r[10].type==SQLITE_INTEGER&&r[10].integer==1;
  int valid_class=0;for(size_t i=0;i<sizeof(nr_execution_classes)/sizeof(*nr_execution_classes)&&good;i++)if(!strcmp((const char*)r[2].bytes,nr_execution_classes[i]))valid_class=1;
  if(good)good=valid_class&&(r[12].type==SQLITE_NULL||nr_intent_text(r+12))&&(r[13].type==SQLITE_NULL||nr_intent_text(r+13))&&nr_pool_physical_metadata(s,r);
  int queued=good&&nr_state(r,"queued"),released=good&&nr_state(r,"released"),slot=good&&nr_role(r,"workflow_child_slot");
  if(good)good=queued||released||nr_state(r,"reserved")||nr_state(r,"unknown");
  if(good&&queued)good=r[9].integer==0&&r[8].type==SQLITE_NULL;
  if(good&&!queued){
   if(slot){good=kind==2&&r[9].integer>=1&&(r[8].type==SQLITE_NULL||nr_intent_text(r+8));}
   else{good=r[9].integer==1&&nr_intent_text(r+8)&&nr_intent_nonce((const char*)r[8].bytes);claims[kind-1]++;}
   const char *receipt_kind=slot?"capacity_reserved":"reserved";
   if(good)good=nr_receipt(fact,r,receipt_kind,slot?NULL:(const char*)r[8].bytes)&&nr_pool_receipt(s,NR_PH_RECEIPTS,(const char*)r[0].bytes,receipt_kind,(const char*)fact[3].bytes);
   nr_cells_clear(fact,NR_MAX_CELLS);
   if(good&&released)good=nr_receipt(fact,r,"released",slot?NULL:(const char*)r[8].bytes)&&nr_pool_receipt(s,NR_PH_RECEIPTS,(const char*)r[0].bytes,"released",(const char*)fact[3].bytes);
   nr_cells_clear(fact,NR_MAX_CELLS);
   if(good&&kind==2&&!slot)good=nr_read_process_intent(s,r,fact,NULL)&&nr_leaf_history(env,s,r,object(env));
   nr_cells_clear(fact,NR_MAX_CELLS);
  }
  /* Count only the closed finite receipt families accepted by this row.
   * Individual leaf facts are fully reconstructed by the original reader. */
  sqlite3_stmt *c=NULL;
  if(good)good=sqlite3_prepare_v2(s->db,"SELECT count(*),sum(CASE WHEN kind IN ('process_binding_v1','process_fence_v1','process_closed_v1') THEN 1 ELSE 0 END) FROM root_physical_receipts WHERE record_id=?",-1,&c,NULL)==SQLITE_OK&&nr_bind(c,1,r)&&sqlite3_step(c)==SQLITE_ROW;
  if(good){sqlite3_int64 leaf=sqlite3_column_int64(c,1),expected=queued?0:1+released+(kind==2&&!slot?1:0);good=sqlite3_column_int64(c,0)==expected+leaf&&(!leaf||(kind==2&&!slot&&!queued))&&sqlite3_step(c)==SQLITE_DONE;}
  if(c&&sqlite3_finalize(c)!=SQLITE_OK)good=0;nr_cells_clear(r,NR_MAX_CELLS);
 }
 if(good)good=step==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 for(int kind=1;kind<=2&&good;kind++){
  nr_cell p[NR_MAX_CELLS]={0};good=nr_physical_policy(s,kind,p)&&nr_intent_text(p+1)&&!strcmp((const char*)p[1].bytes,"native-physical-component")&&nr_intent_text(p+2)&&!strcmp((const char*)p[2].bytes,"{\"profile\":\"M4-P2\"}")&&p[5].integer==rows[kind-1]&&p[6].integer==0&&p[7].integer==claims[kind-1];nr_cells_clear(p,NR_MAX_CELLS);
 }
 return good&&nr_pool_zero(s,"SELECT count(*) FROM root_physical_resources WHERE (resource_kind=1 AND allocation_role<>'direct') OR (allocation_role IN ('workflow_vm','workflow_child_slot') AND execution_class<>'workflow_root') OR (allocation_role IN ('direct','workflow_vm') AND parent_record_id IS NOT NULL) OR (allocation_role IN ('workflow_child_slot','workflow_child_attempt') AND parent_record_id IS NULL) OR (allocation_role<>'direct' AND native_root_id IS NULL)")&&
 nr_pool_zero(s,"SELECT count(*) FROM root_physical_resources c LEFT JOIN root_physical_resources p ON p.record_id=c.parent_record_id WHERE c.parent_record_id IS NOT NULL AND (p.record_id IS NULL OR p.resource_kind<>2 OR p.native_root_id IS NOT c.native_root_id OR (c.allocation_role='workflow_child_slot' AND p.allocation_role<>'workflow_vm') OR (c.allocation_role='workflow_child_attempt' AND p.allocation_role<>'workflow_child_slot'))")&&
 nr_pool_zero(s,"SELECT count(*) FROM root_physical_resources v WHERE v.allocation_role='workflow_vm' AND (SELECT count(*) FROM root_physical_resources s WHERE s.parent_record_id=v.record_id AND s.allocation_role='workflow_child_slot')<>1")&&
 nr_pool_zero(s,"SELECT count(*) FROM root_physical_resources s JOIN root_physical_resources v ON v.record_id=s.parent_record_id WHERE s.allocation_role='workflow_child_slot' AND ((s.state='queued')<>(v.state='queued') OR (s.state='released')<>(v.state='released') OR s.state='unknown' OR s.generation<>(CASE WHEN s.state='queued' THEN 0 ELSE 1 END)+(SELECT count(*) FROM root_physical_resources c WHERE c.parent_record_id=s.record_id AND c.state<>'queued') OR (s.claim_token IS NOT NULL AND NOT EXISTS(SELECT 1 FROM root_physical_resources c WHERE c.record_id=s.claim_token AND c.parent_record_id=s.record_id AND c.state IN ('reserved','unknown'))) OR (s.claim_token IS NULL AND EXISTS(SELECT 1 FROM root_physical_resources c WHERE c.parent_record_id=s.record_id AND c.state IN ('reserved','unknown'))) OR (s.state='released' AND EXISTS(SELECT 1 FROM root_physical_resources c WHERE c.parent_record_id=s.record_id AND c.state<>'released')))")&&
 nr_pool_zero(s,"SELECT count(*) FROM (SELECT resource_kind,count(*) n FROM root_physical_resources WHERE state='queued' GROUP BY resource_kind) WHERE n>256")&&
 nr_pool_zero(s,"SELECT count(*) FROM (SELECT resource_kind,count(*) n FROM root_physical_resources WHERE state IN ('reserved','unknown') AND allocation_role IN ('direct','workflow_vm','workflow_child_slot') GROUP BY resource_kind) WHERE n>CASE resource_kind WHEN 1 THEN 4 ELSE 2 END");
}
static int nr_pool_graph(napi_env env,nr_session *s){
 sqlite3_int64 count=0;
 return floor_valid(s)&&nr_pool_schema(s)&&nr_pool_identity(s)&&scalar(s->db,"SELECT count(*) FROM root_resource_floor",&count)&&count==1&&scalar(s->db,"SELECT count(*) FROM root_resource_policy",&count)&&count==1&&scalar(s->db,"SELECT count(*) FROM root_physical_policy",&count)&&count==2&&nr_pool_n(s)&&nr_pool_physical(env,s);
}
