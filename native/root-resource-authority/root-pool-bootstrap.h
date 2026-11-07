/* Original Main pool restart. This validates historical accounting on the
 * existing locked connection. It never recreates capabilities/eligibility,
 * proves terminal fate, or repairs an old/partial identity namespace. */
static int nr_pool_text(sqlite3_stmt *q,int col,const char *value){
 return sqlite3_column_type(q,col)==SQLITE_TEXT&&sqlite3_column_bytes(q,col)==(int)strlen(value)&&
  !memcmp(sqlite3_column_text(q,col),value,strlen(value));
}
static int nr_pool_zero(nr_session *s,const char *sql){sqlite3_int64 n=-1;return scalar(s->db,sql,&n)&&n==0;}
static int nr_pool_single_text(sqlite3 *db,const char *sql,const char *value){
 sqlite3_stmt *q=NULL;int good=sqlite3_prepare_v2(db,sql,-1,&q,NULL)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&nr_pool_text(q,0,value)&&sqlite3_step(q)==SQLITE_DONE;
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;return good;
}
static int nr_pool_same_query(sqlite3 *actual,sqlite3 *expected,const char *sql){
 sqlite3_stmt *a=NULL,*b=NULL;int good=sqlite3_prepare_v2(actual,sql,-1,&a,NULL)==SQLITE_OK&&sqlite3_prepare_v2(expected,sql,-1,&b,NULL)==SQLITE_OK;
 if(good)good=sqlite3_column_count(a)==sqlite3_column_count(b);
 while(good){int x=sqlite3_step(a),y=sqlite3_step(b);if(x==SQLITE_DONE&&y==SQLITE_DONE)break;
  if(x!=SQLITE_ROW||y!=SQLITE_ROW){good=0;break;}
  for(int i=0;i<sqlite3_column_count(a)&&good;i++){nr_cell c={0};good=nr_from_column(&c,b,i)&&nr_column_equal(&c,a,i);nr_cell_clear(&c);}
 }
 if(a&&sqlite3_finalize(a)!=SQLITE_OK)good=0;if(b&&sqlite3_finalize(b)!=SQLITE_OK)good=0;return good;
}
/* Same bound used by the original primitive subject/context producers. UTF-8
 * is checked without JS coercion, counting original UTF-16 code units. */
static int nr_pool_identity_text(const unsigned char *p,int length){
 int units=0;
 for(int i=0;i<length;){unsigned c=p[i++],value=c,min=0;int following=0;
  if(c>=0xc2&&c<=0xdf){value=c&31;following=1;min=0x80;}
  else if(c>=0xe0&&c<=0xef){value=c&15;following=2;min=0x800;}
  else if(c>=0xf0&&c<=0xf4){value=c&7;following=3;min=0x10000;}
  else if(c>=0x80)return 0;
  for(int j=0;j<following;j++){if(i==length||(p[i]&0xc0)!=0x80)return 0;value=(value<<6)|(p[i++]&63);}
  if(value<(unsigned)min||value>0x10ffff||(value>=0xd800&&value<=0xdfff)||value<32||value==127)return 0;
  units+=value>0xffff?2:1;if(units>256)return 0;
 }return units>0;
}
static int nr_pool_json_identities(nr_session *s,const char *json){
 sqlite3_stmt *q=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT value FROM json_tree(?1) WHERE type='text'",-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,json,-1,SQLITE_STATIC)==SQLITE_OK,step=SQLITE_DONE;
 while(good&&(step=sqlite3_step(q))==SQLITE_ROW)good=sqlite3_column_type(q,0)==SQLITE_TEXT&&nr_pool_identity_text(sqlite3_column_text(q,0),sqlite3_column_bytes(q,0));
 if(good)good=step==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;return good;
}
static int nr_pool_schema(nr_session *s){
 /* Compare the exact original DDL including auto-indexes and every complete
  * full-cell guard. The reference is built by the same production generator. */
 nr_session expected={0};sqlite3_stmt *a=NULL,*b=NULL;
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 expected.root_io=s->root_io;
#endif
 int good=sqlite3_open_v2(":memory:",&expected.db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,NULL)==SQLITE_OK&&execute(&expected,schema)&&(!nr_protected(s)||execute(&expected,schema_io_binding))&&nr_create_guards(&expected);
 const char *sql="SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name";
 if(good)good=sqlite3_prepare_v2(s->db,sql,-1,&a,NULL)==SQLITE_OK&&sqlite3_prepare_v2(expected.db,sql,-1,&b,NULL)==SQLITE_OK;
 while(good){int x=sqlite3_step(a),y=sqlite3_step(b);if(x==SQLITE_DONE&&y==SQLITE_DONE)break;
  if(x!=SQLITE_ROW||y!=SQLITE_ROW){good=0;break;}
  for(int i=0;i<4&&good;i++){nr_cell c={0};good=nr_from_column(&c,b,i)&&nr_column_equal(&c,a,i);nr_cell_clear(&c);}
 }
 if(a&&sqlite3_finalize(a)!=SQLITE_OK)good=0;if(b&&sqlite3_finalize(b)!=SQLITE_OK)good=0;
 for(int t=0;t<nr_table_count(s)&&good;t++){
  char query[256];const char *pragmas[]={"table_xinfo","foreign_key_list","index_list"};
  for(int i=0;i<3&&good;i++){snprintf(query,sizeof(query),"SELECT * FROM pragma_%s('%s')",pragmas[i],nr_tables[t]);good=nr_pool_same_query(s->db,expected.db,query);}
 }
 sqlite3_stmt *indexes=NULL;
 if(good)good=sqlite3_prepare_v2(expected.db,"SELECT name FROM sqlite_schema WHERE type='index' ORDER BY name",-1,&indexes,NULL)==SQLITE_OK;
 int index_step=SQLITE_DONE;
 while(good&&(index_step=sqlite3_step(indexes))==SQLITE_ROW){char query[512];const char *name=(const char*)sqlite3_column_text(indexes,0);int n=snprintf(query,sizeof(query),"SELECT * FROM pragma_index_xinfo('%s')",name);good=n>0&&(size_t)n<sizeof(query)&&nr_pool_same_query(s->db,expected.db,query);}
 if(good)good=index_step==SQLITE_DONE;if(indexes&&sqlite3_finalize(indexes)!=SQLITE_OK)good=0;
 if(expected.db&&sqlite3_close(expected.db)!=SQLITE_OK)good=0;
 return good&&nr_pool_single_text(s->db,"PRAGMA integrity_check","ok")&&nr_pool_zero(s,"SELECT count(*) FROM pragma_foreign_key_check")&&nr_pool_zero(s,"SELECT count(*) FROM sqlite_temp_schema");
}
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
static int nr_pool_protected_identity(nr_session *s){
 nr_root_store_identity identity;
 if(!nr_root_store_read_identity(s->root_io,&identity)||!nr_io_identity_same(&s->io_identity,&identity)||identity.main_principal_uid!=(uint32_t)geteuid())return 0;
 nr_cell rows[2][NR_MAX_CELLS]={0};nr_integer(rows[0],1);nr_integer(rows[0]+1,2);char text[65];
 nr_hex32(identity.pool_id,text);int good=nr_text(rows[0]+2,text);nr_integer(rows[0]+3,identity.main_principal_uid);
 const nr_root_file_fact *facts[]={&identity.directory,&identity.issuer_lock,&identity.database};
 for(int i=0;i<3;i++){nr_integer(rows[0]+4+3*i,(sqlite3_int64)facts[i]->device);nr_integer(rows[0]+5+3*i,(sqlite3_int64)facts[i]->inode);nr_integer(rows[0]+6+3*i,facts[i]->mode);}
 nr_integer(rows[1],1);nr_integer(rows[1]+1,2);
 const unsigned char *ids[]={identity.pool_id,identity.namespace_id,identity.birth_id,identity.claim_id,identity.anchor_digest,identity.profile_digest};
 for(int i=0;i<6&&good;i++){nr_hex32(ids[i],text);good=nr_text(rows[1]+2+i,text);}
 nr_integer(rows[1]+8,identity.file_owner_uid);nr_integer(rows[1]+9,(sqlite3_int64)identity.directory.nlink);nr_integer(rows[1]+10,(sqlite3_int64)identity.issuer_lock.nlink);nr_integer(rows[1]+11,(sqlite3_int64)identity.database.nlink);
 const char *queries[]={"SELECT * FROM root_pool_identity","SELECT * FROM root_pool_io_binding"};
 for(int t=0;t<2&&good;t++){sqlite3_stmt *q=NULL;good=sqlite3_prepare_v2(s->db,queries[t],-1,&q,NULL)==SQLITE_OK&&sqlite3_column_count(q)==(t?12:13)&&sqlite3_step(q)==SQLITE_ROW;
  for(int i=0;i<(t?12:13)&&good;i++)good=nr_column_equal(rows[t]+i,q,i);
  if(good)good=sqlite3_step(q)==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 }
 nr_cells_clear(rows[0],NR_MAX_CELLS);nr_cells_clear(rows[1],NR_MAX_CELLS);return good;
}
static int nr_pool_bind_protected(nr_session *s,enum nr_root_bind_mode mode){
 if(!s->root_io)return 1;
 if(!nr_root_store_bind_bootstrap(s->root_io,mode,mode==NR_FRESH_COMMIT?s->io_claim:NULL,&s->io_identity)||
    !nr_root_store_read_identity(s->root_io,&s->io_identity)||s->io_identity.birth_state!=NR_BOUND){s->unknown=1;return 0;}
 return 1;
}
#endif
static int nr_pool_identity(nr_session *s){
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->root_io)return nr_pool_protected_identity(s);
#endif
 sqlite3_stmt *q=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT * FROM root_pool_identity",-1,&q,NULL)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW;
 for(int i=0;i<13&&good;i++)if(i!=2)good=sqlite3_column_type(q,i)==SQLITE_INTEGER;
 char id[65];if(good)good=sqlite3_column_int64(q,0)==1&&sqlite3_column_int64(q,1)==1&&nr_string_column(q,2,id,sizeof(id),0)&&nr_intent_nonce(id)&&sqlite3_column_int64(q,3)==(sqlite3_int64)geteuid();
 const struct stat *stats[]={&s->directory_identity,&s->lock_identity,&s->database_identity};
 for(int i=0;i<3&&good;i++)good=(uint64_t)stats[i]->st_dev<=INT64_MAX&&(uint64_t)stats[i]->st_ino<=INT64_MAX&&
  sqlite3_column_int64(q,4+3*i)==(sqlite3_int64)stats[i]->st_dev&&sqlite3_column_int64(q,5+3*i)==(sqlite3_int64)stats[i]->st_ino&&sqlite3_column_int64(q,6+3*i)==(sqlite3_int64)stats[i]->st_mode;
 if(good)good=sqlite3_step(q)==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;return good;
}
static int nr_pool_receipt(nr_session *s,int table,const char *id,const char *kind,const char *json){
 char sql[256],hash[65];sqlite3_stmt *q=NULL;if(!nr_hash(json,hash))return 0;
 snprintf(sql,sizeof(sql),"SELECT binding_hash,receipt_json FROM %s WHERE record_id=? AND kind=?",nr_tables[table]);
 int good=sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,id,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_text(q,2,kind,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&nr_pool_text(q,0,hash)&&nr_pool_text(q,1,json)&&sqlite3_step(q)==SQLITE_DONE;
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;return good;
}
static int nr_pool_metadata(nr_session *s,const nr_record *r){
 /* Reconstruct closed source-v2 metadata, rather than accepting a hash of
  * an arbitrary JSON blob. Identity is still historical, never Source grant. */
 const char *subject="CASE json_extract(?1,'$.subject.kind') WHEN 'room_turn' THEN json_object('kind','room_turn','logicalAgentId',json_extract(?1,'$.subject.logicalAgentId'),'messageId',json_extract(?1,'$.subject.messageId'),'roomId',json_extract(?1,'$.subject.roomId'),'turnId',json_extract(?1,'$.subject.turnId')) WHEN 'kswarm_task' THEN json_object('kind','kswarm_task','projectId',json_extract(?1,'$.subject.projectId'),'runId',json_extract(?1,'$.subject.runId'),'taskId',json_extract(?1,'$.subject.taskId')) WHEN 'room_project' THEN json_object('claimId',json_extract(?1,'$.subject.claimId'),'kind','room_project','projectId',json_extract(?1,'$.subject.projectId'),'roomId',json_extract(?1,'$.subject.roomId'),'runId',json_extract(?1,'$.subject.runId'),'taskId',json_extract(?1,'$.subject.taskId')) WHEN 'workflow_root' THEN json_object('kind','workflow_root','rootJobId',json_extract(?1,'$.subject.rootJobId'),'runId',json_extract(?1,'$.subject.runId'),'scriptHash',json_extract(?1,'$.subject.scriptHash'),'workflowId',json_extract(?1,'$.subject.workflowId')) WHEN 'dsh_draft' THEN json_object('draftCommitKey',json_extract(?1,'$.subject.draftCommitKey'),'draftInvocationId',json_extract(?1,'$.subject.draftInvocationId'),'kind','dsh_draft','ownerWorkId',json_extract(?1,'$.subject.ownerWorkId')) END";
 char sql[8192];int n=snprintf(sql,sizeof(sql),"SELECT json_object('authorizationRef',json_extract(?1,'$.authorizationRef'),'executionClass',json_extract(?1,'$.executionClass'),'executionKey',json_extract(?1,'$.executionKey'),'hostId',json_extract(?1,'$.hostId'),'payloadHash',json_extract(?1,'$.payloadHash'),'priorityClass','background','schemaVersion',2,'scope',json_object('principalId',json_extract(?1,'$.scope.principalId'),'profileId',json_extract(?1,'$.scope.profileId'),'workspaceId',json_extract(?1,'$.scope.workspaceId')),'subject',json(%s)), '[\"root-execution-key-v2\",'||json_object('hostId',json_extract(?1,'$.hostId'),'scope',json_object('principalId',json_extract(?1,'$.scope.principalId'),'profileId',json_extract(?1,'$.scope.profileId'),'workspaceId',json_extract(?1,'$.scope.workspaceId')),'subject',json(%s))||']',json_extract(?1,'$.executionClass'),json_extract(?1,'$.subject.kind'),json_extract(?1,'$.payloadHash')",subject,subject);
 sqlite3_stmt *q=NULL;int good=n>0&&(size_t)n<sizeof(sql)&&sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,r->metadata,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&nr_pool_text(q,0,r->metadata);
 char digest[65],key[69],payload[65],cls[32],kind[32];
 if(good)good=sqlite3_column_type(q,1)==SQLITE_TEXT&&nr_hash((const char*)sqlite3_column_text(q,1),digest)&&nr_string_column(q,2,cls,sizeof(cls),0)&&nr_string_column(q,3,kind,sizeof(kind),0)&&nr_string_column(q,4,payload,sizeof(payload),0)&&nr_intent_nonce(payload);
 if(good){snprintf(key,sizeof(key),"nr2:%s",digest);good=!strcmp(r->key,key)&&((!strcmp(cls,"room_discussion")&&!strcmp(kind,"room_turn"))||(!strcmp(cls,"room_project")&&!strcmp(kind,"room_project"))||(!strcmp(cls,"kswarm_direct")&&!strcmp(kind,"kswarm_task"))||(!strcmp(cls,"workflow_root")&&!strcmp(kind,"workflow_root"))||(!strcmp(cls,"dsh_draft")&&!strcmp(kind,"dsh_draft")))&&sqlite3_step(q)==SQLITE_DONE;}
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 /* Every identity leaf emitted by these original producers is nonempty text;
  * numeric/null/container substitutions cannot pass canonical reconstruction. */
 if(good){q=NULL;good=sqlite3_prepare_v2(s->db,"SELECT count(*) FROM json_tree(?1) WHERE type NOT IN ('object','text','integer') OR (type='integer' AND fullkey<>'$.schemaVersion') OR (type='text' AND (length(value)=0 OR instr(value,char(0))>0))",-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,r->metadata,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&sqlite3_column_int64(q,0)==0&&sqlite3_step(q)==SQLITE_DONE;if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;}
 return good&&nr_pool_json_identities(s,r->metadata);
}
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
static napi_value bootstrap_original_main_pool(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(s->bootstrap_attempted)return fail(env,"ROOT_RESOURCE_BOOTSTRAP_ALREADY_ATTEMPTED");
 s->bootstrap_attempted=1;
 sqlite3_int64 count=-1;
 if(!scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count))return nr_error(env,s,"ROOT_RESOURCE_BOOTSTRAP_UNCONFIRMED",0,0,0);
 if(count==0){
  napi_value installed=install_fresh(env,info);if(!installed)return NULL;
  if(s->root_io&&(!nr_pool_graph(env,s)||!nr_pool_bind_protected(s,NR_FRESH_COMMIT)))return nr_error(env,s,"ROOT_RESOURCE_INSTALLED_BINDING_UNCONFIRMED",0,0,1);
  napi_value out=NULL;if(napi_create_string_utf8(env,"fresh",NAPI_AUTO_LENGTH,&out)!=napi_ok||!main_session_current(env,s))return nr_error(env,s,"ROOT_RESOURCE_BOOTSTRAP_UNCONFIRMED",0,0,1);s->bootstrap_status=1;return out;
 }
 if(!floor_valid(s)){
  if(floor_history_valid(s))return fail(env,"ROOT_RESOURCE_LEGACY_POOL_IDENTITY_UNCONFIRMED");
  return nr_error(env,s,"ROOT_RESOURCE_RESTORE_UNCONFIRMED",0,0,0);
 }
 int began=execute(s,"BEGIN IMMEDIATE"),good=began;
 if(good)good=!s->created_db&&!s->created_lock&&current(s)&&nr_pool_graph(env,s)&&main_session_current(env,s)&&current(s);
 if(good){good=execute(s,"COMMIT")&&sqlite3_get_autocommit(s->db)==1;if(!good)s->unknown=1;}
 else if(began&&!execute(s,"ROLLBACK"))s->unknown=1;
 if(!good||s->unknown||s->closed||!current(s))return nr_error(env,s,"ROOT_RESOURCE_RESTORE_UNCONFIRMED",0,0,0);
 if(s->root_io&&!nr_pool_bind_protected(s,NR_RECOVER_COMMITTED))return nr_error(env,s,"ROOT_RESOURCE_INSTALLED_BINDING_UNCONFIRMED",0,0,1);
 /* No historical eligible list or opaque token is imported. Old capacity and
  * queue rows remain unchanged. Only new original enqueues become eligible. */
 s->fresh_owner=1;napi_value out=NULL;
 if(napi_create_string_utf8(env,"restored",NAPI_AUTO_LENGTH,&out)!=napi_ok||!main_session_current(env,s))return nr_error(env,s,"ROOT_RESOURCE_RESTORE_UNCONFIRMED",0,0,1);
 s->bootstrap_status=2;return out;
}


/* Passive same-session bootstrap fact. No SQL, re-install or new capability. */
static napi_value read_original_main_pool_bootstrap(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(!main_session_current(env,s))return NULL;
 if(s->bootstrap_status!=1&&s->bootstrap_status!=2)return fail(env,"ROOT_RESOURCE_BOOTSTRAP_REQUIRED");
 int sealed=s->business_sealed;napi_value out=object(env);
 if(!out||!text(env,out,"kind","original_main_pool_bootstrap_v1")||!text(env,out,"bootstrap",s->bootstrap_status==1?"fresh":"restored")||
    !text(env,out,"profile",nr_profile(s))||!number(env,out,"schemaVersion",nr_schema_version(s))||!text(env,out,"semanticDigest",nr_digest(s))||
    !boolean(env,out,"businessSealed",sealed)||napi_object_freeze(env,out)!=napi_ok||!main_session_current(env,s)||s->business_sealed!=sealed)
  return nr_error(env,s,"ROOT_RESOURCE_BOOTSTRAP_UNCONFIRMED",0,0,0);
 return out;
}
/* Negative logical seal never revokes the shared Core environment or IO. */
static napi_value seal_original_main_root_business(napi_env env,napi_callback_info info){
 napi_value args[2],out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 s->business_sealed=1;
 if(napi_get_undefined(env,&out)!=napi_ok)return NULL;
 return out;
}

#ifdef NR_FIXTURE_BUILD
/* Closed finite faults after actual original writes/COMMIT. No caller SQL,
 * callbacks, result DTOs or production grant is supplied by this seam. */
static napi_value arm_pool_bootstrap_failure(napi_env env,napi_callback_info info){
 napi_value args[3],out;int32_t value=0;double exact=0;napi_valuetype type;
 if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;if(!main_session_current(env,s))return NULL;
 if(napi_typeof(env,args[1],&type)!=napi_ok||type!=napi_number||napi_get_value_int32(env,args[1],&value)!=napi_ok||napi_get_value_double(env,args[1],&exact)!=napi_ok||exact!=(double)value||value<1||value>6)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_INVALID");
 if(s->bootstrap_attempted||s->writing||s->fresh_owner||s->fixture_bootstrap_failure||!s->created_lock||!s->created_db)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_UNAVAILABLE");
 s->fixture_bootstrap_failure=value;napi_get_undefined(env,&out);return out;
}
#endif
