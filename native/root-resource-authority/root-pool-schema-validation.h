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
 if(s->schema_reference)return 0;
 int good=sqlite3_open_v2(":memory:",&s->schema_reference,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,NULL)==SQLITE_OK;
 expected.db=s->schema_reference;
 if(good)good=execute(&expected,schema)&&(!nr_protected(s)||execute(&expected,schema_io_binding))&&nr_create_guards(&expected);
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
#ifdef NR_FIXTURE_BUILD
 if(good&&s->fixture_schema_busy){s->fixture_schema_busy=0;good=sqlite3_prepare_v2(s->schema_reference,"SELECT 1",-1,&s->fixture_schema_statement,NULL)==SQLITE_OK&&sqlite3_step(s->fixture_schema_statement)==SQLITE_ROW;}
#endif
 if(s->schema_reference){int rc=sqlite3_close(s->schema_reference);if(rc!=SQLITE_OK){if(!s->ledger_failure_code)s->ledger_failure_code=rc;good=0;s->unknown=1;}else s->schema_reference=NULL;}
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
