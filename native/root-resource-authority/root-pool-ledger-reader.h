/* Original connection, complete typed historical ledger. No authority, writes,
 * spendability, old-FD closure or scheduling capability is projected. */
#if defined(NR_FIXTURE_BUILD) && defined(NR_FIXTURE_LEDGER_SMALL_LIMIT)
#define NR_LEDGER_LIMIT 1024U
#else
#define NR_LEDGER_LIMIT (64U*1024U*1024U)
#endif
typedef struct {char *bytes;size_t size,capacity;int limited;} nr_ledger_bytes;
static void nr_ledger_clear(nr_ledger_bytes *b){free(b->bytes);memset(b,0,sizeof(*b));}
static int nr_ledger_append(nr_ledger_bytes *b,const void *data,size_t n){
 if(n>NR_LEDGER_LIMIT-b->size){b->limited=1;return 0;}
 size_t need=b->size+n+1;
 if(need>b->capacity){size_t cap=b->capacity?b->capacity:4096;while(cap<need&&cap<NR_LEDGER_LIMIT+1U)cap=cap>(NR_LEDGER_LIMIT+1U)/2?NR_LEDGER_LIMIT+1U:cap*2;char *p=realloc(b->bytes,cap);if(!p)return 0;b->bytes=p;b->capacity=cap;}
 if(n)memcpy(b->bytes+b->size,data,n);b->size+=n;b->bytes[b->size]=0;return 1;
}
static int nr_ledger_literal(nr_ledger_bytes *b,const char *s){return nr_ledger_append(b,s,strlen(s));}
static int nr_ledger_integer(nr_ledger_bytes *b,sqlite3_int64 n){char v[32];int size=snprintf(v,sizeof(v),"%lld",(long long)n);return size>0&&(size_t)size<sizeof(v)&&nr_ledger_append(b,v,(size_t)size);}
static int nr_ledger_hex(nr_ledger_bytes *b,const void *raw,int n){
 static const char digits[]="0123456789abcdef";const unsigned char *p=raw;
 if(n<0||(!p&&n))return 0;
 if((size_t)n>(NR_LEDGER_LIMIT-b->size)/2){b->limited=1;return 0;}
 for(int i=0;i<n;i++){char out[]={digits[p[i]>>4],digits[p[i]&15]};if(!nr_ledger_append(b,out,2))return 0;}return 1;
}
static int nr_ledger_cell(nr_ledger_bytes *b,sqlite3_stmt *q,int col){
 int type=sqlite3_column_type(q,col);
 if(type==SQLITE_NULL)return nr_ledger_literal(b,"[\"null\"]");
 if(type==SQLITE_INTEGER)return nr_ledger_literal(b,"[\"integer\",\"")&&nr_ledger_integer(b,sqlite3_column_int64(q,col))&&nr_ledger_literal(b,"\"]");
 if(type!=SQLITE_TEXT&&type!=SQLITE_BLOB)return 0;
 const void *data=sqlite3_column_blob(q,col);int length=sqlite3_column_bytes(q,col);
 return nr_ledger_literal(b,type==SQLITE_TEXT?"[\"text\",\"":"[\"blob\",\"")&&nr_ledger_hex(b,data,length)&&nr_ledger_literal(b,"\"]");
}
static int nr_ledger_rows(nr_session *s,nr_ledger_bytes *b,const char *sql,int columns){
 sqlite3_stmt *q=NULL;int good=sqlite3_prepare_v2(s->db,sql,-1,&q,NULL)==SQLITE_OK&&sqlite3_column_count(q)==columns,step=SQLITE_ERROR;size_t rows=0;
 if(good)good=nr_ledger_literal(b,"[");
 while(good&&(step=sqlite3_step(q))==SQLITE_ROW){
  good=(!rows++||nr_ledger_literal(b,","))&&nr_ledger_literal(b,"[");
  for(int col=0;col<columns&&good;col++)good=(!col||nr_ledger_literal(b,","))&&nr_ledger_cell(b,q,col);
  good=good&&nr_ledger_literal(b,"]");
 }
 good=good&&step==SQLITE_DONE&&nr_ledger_literal(b,"]");if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;return good;
}
static int nr_ledger_identity(nr_session *s,nr_ledger_bytes *b){
 uint64_t facts[3][5];
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->root_io){
  const nr_root_file_fact *f[]={&s->io_identity.directory,&s->io_identity.issuer_lock,&s->io_identity.database};
  for(int i=0;i<3;i++){facts[i][0]=f[i]->device;facts[i][1]=f[i]->inode;facts[i][2]=s->io_identity.file_owner_uid;facts[i][3]=f[i]->mode;facts[i][4]=f[i]->nlink;}
 }else
#endif
 {
  struct stat f[3];if(fstat(s->directory,f)||fstat(s->lock_fd,f+1)||fstatat(s->directory,"root-resource-v1.sqlite",f+2,AT_SYMLINK_NOFOLLOW))return 0;
  for(int i=0;i<3;i++){facts[i][0]=(uint64_t)f[i].st_dev;facts[i][1]=(uint64_t)f[i].st_ino;facts[i][2]=f[i].st_uid;facts[i][3]=f[i].st_mode;facts[i][4]=f[i].st_nlink;}
 }
 if(!nr_ledger_literal(b,nr_protected(s)?"{\"kind\":\"protected-anchor-birth-audit-v2\",\"facts\":[":"{\"kind\":\"ordinary-current-files-v1\",\"facts\":["))return 0;
 for(int i=0;i<3;i++){
  if((i&&!nr_ledger_literal(b,","))||!nr_ledger_literal(b,"["))return 0;
  for(int j=0;j<5;j++){char n[32];int length=snprintf(n,sizeof(n),"%llu",(unsigned long long)facts[i][j]);if((j&&!nr_ledger_literal(b,","))||!nr_ledger_literal(b,"\"")||length<1||(size_t)length>=sizeof(n)||!nr_ledger_append(b,n,(size_t)length)||!nr_ledger_literal(b,"\""))return 0;}
  if(!nr_ledger_literal(b,"]"))return 0;
 }return nr_ledger_literal(b,"]}");
}
static int nr_ledger_body(nr_session *s,nr_ledger_bytes *b,const char *source_kind){
 char prefix[768],pool[65];sqlite3_stmt *q=NULL;
 int good=sqlite3_prepare_v2(s->db,"SELECT pool_id FROM root_pool_identity WHERE singleton=1",-1,&q,NULL)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&nr_string_column(q,0,pool,sizeof(pool),0)&&nr_intent_nonce(pool)&&sqlite3_step(q)==SQLITE_DONE;
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;if(!good)return 0;
 int n=snprintf(prefix,sizeof(prefix),"{\"kind\":\"original_root_nmp_ledger_v1\",\"observation\":\"history-observation-only\",\"sourceKind\":\"%s\",\"poolScope\":\"account-global\",\"profile\":\"%s\",\"schemaVersion\":%d,\"semanticDigest\":\"%s\",\"poolId\":\"%s\",\"ownerUid\":\"%llu\",\"schema\":",source_kind,nr_profile(s),nr_schema_version(s),nr_digest(s),pool,(unsigned long long)geteuid());
 good=n>0&&(size_t)n<sizeof(prefix)&&nr_ledger_append(b,prefix,(size_t)n)&&nr_ledger_rows(s,b,"SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type COLLATE BINARY,name COLLATE BINARY",4)&&nr_ledger_literal(b,",\"sourceIdentity\":")&&nr_ledger_identity(s,b)&&nr_ledger_literal(b,",\"tables\":[");
 const char *order[]={"singleton","singleton","record_id COLLATE BINARY","record_id COLLATE BINARY","record_id COLLATE BINARY,kind COLLATE BINARY","kind","record_id COLLATE BINARY","record_id COLLATE BINARY,kind COLLATE BINARY","singleton","singleton"};
 for(int t=0;t<nr_table_count(s)&&good;t++){
  good=(!t||nr_ledger_literal(b,","))&&nr_ledger_literal(b,"{\"name\":\"")&&nr_ledger_literal(b,nr_tables[t])&&nr_ledger_literal(b,"\",\"columns\":[");
  for(int i=0;i<nr_counts[t]&&good;i++)good=(!i||nr_ledger_literal(b,","))&&nr_ledger_literal(b,"\"")&&nr_ledger_literal(b,nr_columns[t][i])&&nr_ledger_literal(b,"\"");
  char sql[512];n=snprintf(sql,sizeof(sql),"SELECT * FROM %s ORDER BY %s",nr_tables[t],order[t]);
  good=good&&n>0&&(size_t)n<sizeof(sql)&&nr_ledger_literal(b,"],\"rows\":")&&nr_ledger_rows(s,b,sql,nr_counts[t])&&nr_ledger_literal(b,"}");
 }
 return good&&nr_ledger_literal(b,"]}");
}
/* Preserve the 64-bit mutation counter. Older system SQLite is a typed
 * unsupported runtime, never a 32-bit or empty-history fallback. */
static int nr_ledger_changes(sqlite3 *db,sqlite3_int64 *out){
 if(__builtin_available(macOS 12.3,*)){*out=sqlite3_total_changes64(db);return 1;}return 0;
}
static int nr_ledger_capture(napi_env env,nr_session *s,const char *kind,nr_ledger_bytes *bytes,const char **error){
 *error="ROOT_LEDGER_UNCONFIRMED";
 if(s->closed||s->unknown||s->birth_pid!=getpid()||s->ledger_reading||s->writing||s->installing||!s->db){*error="ROOT_LEDGER_SOURCE_BUSY";return 0;}
 int good=0,began=0;sqlite3_int64 before=0,after=0,changes=0,observed=0;
 s->ledger_reading=1;
 if(!sqlite3_get_autocommit(s->db)){*error="ROOT_LEDGER_SOURCE_BUSY";goto done;}
 if(!current(s)){s->unknown=1;goto done;}
 if(!nr_protected(s)&&floor_match(s,"ordinary_runtime_root_resource_reservation_writer_v8_protected_io","8dc149dce2d161efe6805547451be7284377b3157510cfd60f6717defd528c59","xiaok_root_resource_reservation_writer_v7",4)){*error="ROOT_LEDGER_PROTECTED_SOURCE_REQUIRED";goto done;}
 if(!floor_valid(s)){*error=floor_history_valid(s)?"ROOT_LEDGER_HISTORY_PROFILE_UNSUPPORTED":"ROOT_LEDGER_FLOOR_UNCONFIRMED";goto done;}
 if(!nr_ledger_changes(s->db,&changes)){*error="ROOT_LEDGER_RUNTIME_UNSUPPORTED";goto done;}good=scalar(s->db,"PRAGMA data_version",&before);
 if(good){began=execute(s,"BEGIN");good=began;}
 if(good)good=nr_pool_graph(env,s)&&current(s)&&nr_ledger_body(s,bytes,kind)&&nr_pool_graph(env,s)&&current(s)&&nr_ledger_changes(s->db,&observed)&&observed==changes;
 if(good){good=execute(s,"COMMIT")&&sqlite3_get_autocommit(s->db);if(!good)s->unknown=1;}
 if(began&&!sqlite3_get_autocommit(s->db)&&!execute(s,"ROLLBACK"))s->unknown=1;
 if(good)good=scalar(s->db,"PRAGMA data_version",&after)&&before==after&&current(s)&&!s->closed&&!s->unknown;
 if(!good&&before!=after&&after)*error="ROOT_LEDGER_SOURCE_STALE";
 if(!good&&bytes->limited)*error="ROOT_LEDGER_LIMIT";
 if(!good&&!bytes->limited)s->unknown=1;
done:
 s->ledger_reading=0;if(!good)nr_ledger_clear(bytes);return good;
}
static napi_value nr_ledger_failure(napi_env env,nr_session *s,const char *error){
 napi_value message,exception;napi_create_string_utf8(env,error,NAPI_AUTO_LENGTH,&message);napi_create_error(env,NULL,message,&exception);
 number(env,exception,"schemaReferenceCloseCode",s->ledger_failure_code);napi_throw(env,exception);return NULL;
}
static napi_value nr_ledger_projection(napi_env env,nr_ledger_bytes *bytes){
 static const char domain[]="xiaok.original-root-nmp-ledger/v1";unsigned char length[8],digest[CC_SHA256_DIGEST_LENGTH];char hash[65];CC_SHA256_CTX ctx;
 for(int i=0;i<8;i++)length[7-i]=(unsigned char)((uint64_t)bytes->size>>(8*i));
 CC_SHA256_Init(&ctx);CC_SHA256_Update(&ctx,domain,sizeof(domain));CC_SHA256_Update(&ctx,length,sizeof(length));CC_SHA256_Update(&ctx,bytes->bytes,(CC_LONG)bytes->size);CC_SHA256_Final(digest,&ctx);
 static const char digits[]="0123456789abcdef";for(size_t i=0;i<sizeof(digest);i++){hash[2*i]=digits[digest[i]>>4];hash[2*i+1]=digits[digest[i]&15];}hash[64]=0;
 napi_value out=object(env),json=NULL;int good=out&&napi_create_string_utf8(env,bytes->bytes,bytes->size,&json)==napi_ok&&text(env,out,"kind","original_root_nmp_ledger_capture_v1")&&own_data(env,out,"canonicalJson",json)&&text(env,out,"sha256",hash)&&napi_object_freeze(env,out)==napi_ok;
 nr_ledger_clear(bytes);return good?out:fail(env,"ROOT_LEDGER_PROJECTION_UNCONFIRMED");
}
static napi_value read_original_root_pool_ledger(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],0);if(!s)return NULL;
 nr_ledger_bytes bytes={0};const char *error=NULL;
 if(!nr_ledger_capture(env,s,"live-session",&bytes,&error))return nr_ledger_failure(env,s,error);
 if(!current(s)||s->closed||s->unknown||s->birth_pid!=getpid()){nr_ledger_clear(&bytes);return fail(env,"ROOT_LEDGER_SOURCE_STALE");}
 return nr_ledger_projection(env,&bytes);
}

#ifdef NR_FIXTURE_BUILD
/* Actual sqlite3_close returns BUSY with an actual unfinalized statement.
 * The fixed negative close must retain/finalize that same reference handle. */
static napi_value fixture_hold_schema_reference(napi_env env,napi_callback_info info){
 napi_value args[2],out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],0);if(!s)return NULL;
 if(s->schema_reference||s->fixture_schema_busy)return fail(env,"ROOT_LEDGER_FIXTURE_BUSY");
 s->fixture_schema_busy=1;napi_get_undefined(env,&out);return out;
}
#endif
