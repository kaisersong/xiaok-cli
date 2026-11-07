/* Cold metadata reconstruction. The original receipt hash, SQL TEXT class,
 * complete bytes and relations are checked together. No handle is returned. */
static int nr_leaf_history_fact(nr_session *s,const nr_cell *row,const char *nonce,const char *spec,const char *kind,
 const char *expression,const char *predicate,const char *binding,int fence,int fence_go,nr_cell *out){
 char sql[16384];int n=snprintf(sql,sizeof(sql),"SELECT binding_hash,receipt_json,%s,(%s) FROM root_physical_receipts WHERE record_id=?1 AND kind=?2",expression,predicate);
 sqlite3_stmt *q=NULL;int result=-1,good=n>0&&(size_t)n<sizeof(sql)&&sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&
  nr_bind(q,1,row)&&sqlite3_bind_text(q,2,kind,-1,SQLITE_STATIC)==SQLITE_OK;
 // All expressions use the same numbered closed binding parameters. SQLite
 // permits unused numbered slots; there is no caller-selected SQL fragment.
 if(good&&sqlite3_bind_parameter_count(q)>=3)good=sqlite3_bind_text(q,3,nonce,-1,SQLITE_STATIC)==SQLITE_OK;
 if(good&&sqlite3_bind_parameter_count(q)>=4)good=sqlite3_bind_text(q,4,spec,-1,SQLITE_STATIC)==SQLITE_OK;
 if(good&&sqlite3_bind_parameter_count(q)>=5)good=nr_bind(q,5,row+8);
 if(good&&sqlite3_bind_parameter_count(q)>=6)good=nr_bind(q,6,row+10);
 if(good&&sqlite3_bind_parameter_count(q)>=7)good=nr_bind(q,7,row+9);
 if(good&&sqlite3_bind_parameter_count(q)>=8)good=binding?sqlite3_bind_text(q,8,binding,-1,SQLITE_STATIC)==SQLITE_OK:sqlite3_bind_null(q,8)==SQLITE_OK;
 if(good&&sqlite3_bind_parameter_count(q)>=9)good=sqlite3_bind_int(q,9,fence)==SQLITE_OK;
 if(good&&sqlite3_bind_parameter_count(q)>=10)good=sqlite3_bind_int(q,10,fence_go)==SQLITE_OK;
 int step=good?sqlite3_step(q):SQLITE_ERROR;
 if(step==SQLITE_DONE)result=0;
 else if(step==SQLITE_ROW){
  nr_cell hash={0},body={0},expected={0};char digest[65];
  good=nr_from_column(&hash,q,0)&&nr_from_column(&body,q,1)&&nr_from_column(&expected,q,2)&&nr_intent_text(&hash)&&nr_intent_text(&body)&&nr_intent_text(&expected)&&
   hash.length==64&&body.length==expected.length&&!memcmp(body.bytes,expected.bytes,(size_t)body.length)&&
   sqlite3_column_type(q,3)==SQLITE_INTEGER&&sqlite3_column_int(q,3)==1&&nr_hash((const char*)expected.bytes,digest)&&!memcmp(hash.bytes,digest,64)&&
   nr_text(out,(const char*)hash.bytes)&&nr_text(out+1,(const char*)body.bytes)&&sqlite3_step(q)==SQLITE_DONE;
  nr_cell_clear(&hash);nr_cell_clear(&body);nr_cell_clear(&expected);if(good)result=1;
 }
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)result=-1;return result;
}
static int nr_leaf_history(napi_env env,nr_session *s,const nr_cell *row,napi_value out){
 nr_cell intent[NR_MAX_CELLS]={0},binding[2]={0},fence[2]={0},closed[2]={0};
 char nonce[65],spec[65];sqlite3_stmt *q=NULL;int good=nr_read_process_intent(s,row,intent,NULL)&&
  sqlite3_prepare_v2(s->db,"SELECT json_extract(?1,'$.launchNonce'),json_extract(?1,'$.specHash')",-1,&q,NULL)==SQLITE_OK&&nr_bind(q,1,intent+3)&&sqlite3_step(q)==SQLITE_ROW&&
  nr_string_column(q,0,nonce,sizeof(nonce),0)&&nr_string_column(q,1,spec,sizeof(spec),0)&&nr_intent_nonce(nonce)&&nr_intent_nonce(spec)&&sqlite3_step(q)==SQLITE_DONE;
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;q=NULL;
 const char *binding_expression="json_object('schemaVersion',1,'kind','original_readonly_leaf_binding_v1','recordId',?1,'launchNonce',?3,'claimToken',?5,'specHash',?4,'issuerEpoch',?6,'acquireGeneration',?7,'bootId',json_extract(receipt_json,'$.bootId'),'pid',json_extract(receipt_json,'$.pid'),'uid',json_extract(receipt_json,'$.uid'),'startSeconds',json_extract(receipt_json,'$.startSeconds'),'startMicros',json_extract(receipt_json,'$.startMicros'),'profile','darwin_nofork_bounded_glob_js_v1','assetHash',json_extract(receipt_json,'$.assetHash'),'policyHash','25d8f461c921e3eef2af5974cf5a29706335d99e41663b557647ab2a36357714')";
 const char *binding_predicate="json_type(receipt_json,'$.bootId')='text' AND length(json_extract(receipt_json,'$.bootId'))=36 AND length(replace(json_extract(receipt_json,'$.bootId'),'-',''))=32 AND lower(json_extract(receipt_json,'$.bootId')) NOT GLOB '*[^a-f0-9-]*' AND substr(json_extract(receipt_json,'$.bootId'),9,1)='-' AND substr(json_extract(receipt_json,'$.bootId'),14,1)='-' AND substr(json_extract(receipt_json,'$.bootId'),19,1)='-' AND substr(json_extract(receipt_json,'$.bootId'),24,1)='-' AND json_type(receipt_json,'$.pid')='integer' AND json_extract(receipt_json,'$.pid') BETWEEN 1 AND 2147483647 AND json_type(receipt_json,'$.uid')='integer' AND json_extract(receipt_json,'$.uid') BETWEEN 0 AND 4294967295 AND json_type(receipt_json,'$.startSeconds')='integer' AND json_extract(receipt_json,'$.startSeconds') BETWEEN 1 AND 9007199254740991 AND json_type(receipt_json,'$.startMicros')='integer' AND json_extract(receipt_json,'$.startMicros') BETWEEN 0 AND 999999 AND json_type(receipt_json,'$.assetHash')='text' AND length(json_extract(receipt_json,'$.assetHash'))=64 AND json_extract(receipt_json,'$.assetHash') NOT GLOB '*[^a-f0-9]*'";
 int has_binding=good?nr_leaf_history_fact(s,row,nonce,spec,"process_binding_v1",binding_expression,binding_predicate,NULL,0,0,binding):-1;
 good=good&&has_binding>=0;
 const char *fence_expression="json_object('schemaVersion',1,'kind','original_readonly_leaf_fence_v1','recordId',?1,'launchNonce',?3,'goEntered',json(CASE WHEN json_extract(receipt_json,'$.goEntered') THEN 'true' ELSE 'false' END),'reason','original_owned_cancel')";
 const char *fence_predicate="json_type(receipt_json,'$.goEntered') IN ('true','false') AND (json_extract(receipt_json,'$.goEntered')=0 OR ?8 IS NOT NULL)";
 int has_fence=good?nr_leaf_history_fact(s,row,nonce,spec,"process_fence_v1",fence_expression,fence_predicate,has_binding?(const char*)binding[0].bytes:NULL,0,0,fence):-1;
 good=good&&has_fence>=0;
 int fence_go=0;
 if(good&&has_fence){
  good=sqlite3_prepare_v2(s->db,"SELECT json_extract(?1,'$.goEntered')",-1,&q,NULL)==SQLITE_OK&&nr_bind(q,1,fence+1)&&sqlite3_step(q)==SQLITE_ROW&&sqlite3_column_type(q,0)==SQLITE_INTEGER;
  if(good){fence_go=sqlite3_column_int(q,0);good=(fence_go==0||fence_go==1)&&sqlite3_step(q)==SQLITE_DONE;}
  if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;q=NULL;
 }

 const char *closed_expression="json_object('schemaVersion',1,'kind','original_readonly_leaf_closed_v1','recordId',?1,'launchNonce',?3,'bindingHash',?8,'goEntered',json(CASE WHEN json_extract(receipt_json,'$.goEntered') THEN 'true' ELSE 'false' END),'readyObserved',json(CASE WHEN json_extract(receipt_json,'$.readyObserved') THEN 'true' ELSE 'false' END),'fenced',json(CASE WHEN ?9 THEN 'true' ELSE 'false' END),'waitKind',json_extract(receipt_json,'$.waitKind'),'exitCode',json_extract(receipt_json,'$.exitCode'),'signal',json_extract(receipt_json,'$.signal'),'profile','darwin_nofork_bounded_glob_js_v1')";
 const char *closed_predicate="json_type(receipt_json,'$.goEntered') IN ('true','false') AND json_type(receipt_json,'$.readyObserved') IN ('true','false') AND json_type(receipt_json,'$.fenced') IN ('true','false') AND json_type(receipt_json,'$.waitKind')='text' AND json_type(receipt_json,'$.exitCode')='integer' AND json_type(receipt_json,'$.signal')='integer' AND (json_extract(receipt_json,'$.goEntered')=0 OR (?8 IS NOT NULL AND json_extract(receipt_json,'$.readyObserved')=1)) AND (?8 IS NULL OR json_extract(receipt_json,'$.readyObserved')=1) AND (?9=0 OR json_extract(receipt_json,'$.goEntered')=?10) AND ((json_extract(receipt_json,'$.waitKind')='owned_waitpid' AND ((json_extract(receipt_json,'$.exitCode') BETWEEN 0 AND 255 AND json_extract(receipt_json,'$.signal')=0) OR (json_extract(receipt_json,'$.exitCode')=-1 AND json_extract(receipt_json,'$.signal') BETWEEN 1 AND 64))) OR (json_extract(receipt_json,'$.waitKind') IN ('rejected_spawn','not_entered') AND json_extract(receipt_json,'$.exitCode')=-1 AND json_extract(receipt_json,'$.signal')=0 AND json_extract(receipt_json,'$.goEntered')=0))";
 int has_closed=good?nr_leaf_history_fact(s,row,nonce,spec,"process_closed_v1",closed_expression,closed_predicate,has_binding?(const char*)binding[0].bytes:NULL,has_fence,fence_go,closed):-1;
 good=good&&has_closed>=0&&(!(has_binding||has_fence)||!nr_state(row,"released")||has_closed);
 if(good&&(has_binding||has_fence||has_closed)){
  napi_value meta=object(env),none=nr_null(env);
  good=meta&&text(env,meta,"eligibility","history_only")&&text(env,meta,"profile","darwin_nofork_bounded_glob_js_v1");
  const char *names[]={"bindingReceipt","fenceReceipt","closedReceipt"};nr_cell *facts[]={binding,fence,closed};int present[]={has_binding,has_fence,has_closed};
  for(int i=0;i<3&&good;i++)good=present[i]?text(env,meta,names[i],(const char*)facts[i][1].bytes):own_data(env,meta,names[i],none);
  good=good&&own_data(env,out,"leafHistory",meta);
 }
 nr_cells_clear(intent,NR_MAX_CELLS);nr_cells_clear(binding,2);nr_cells_clear(fence,2);nr_cells_clear(closed,2);return good;
}
