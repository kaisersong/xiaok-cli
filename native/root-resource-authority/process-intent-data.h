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
