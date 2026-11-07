/* Private implementation of the original Native connection's reservation
 * transactions. No caller SQL, verifier, path or JS callback enters this file. */
#ifndef NR_RESERVATION_TYPES
#define NR_RESERVATION_TYPES
#include <CommonCrypto/CommonDigest.h>
#include <time.h>
#define NR_MAX_SAFE 9007199254740991LL
#define NR_MAX_CELLS 14
#define NR_MAX_WRITES 8
typedef struct {int type;sqlite3_int64 integer;int length;unsigned char *bytes;} nr_cell;
typedef struct {int table,op,seen;nr_cell old[NR_MAX_CELLS],next[NR_MAX_CELLS];} nr_write;
typedef struct nr_eligible {
 struct nr_eligible *next;
 char record_id[257],digest[65];sqlite3_int64 seq,deadline;
 int has_deadline,priority,physical_kind;
} nr_eligible;
static void nr_clear_frame(struct nr_session *s);
static void nr_clear_eligible(struct nr_session *s);
static void nr_guard(struct nr_session *s,sqlite3_context *ctx,int argc,sqlite3_value **argv);
static int nr_authorized_write(struct nr_session *s,int action,const char *table);
static int nr_create_guards(struct nr_session *s);
static int nr_install_rows(struct nr_session *s);
static int nr_install_pool_identity(struct nr_session *s);
static int nr_verify_frame(struct nr_session *s);
#endif

#ifdef NR_RESERVATION_IMPLEMENTATION
#if defined(NR_FIXTURE_BUILD) && defined(NR_FIXTURE_FACTS_HEADER)
#include NR_FIXTURE_FACTS_HEADER
#define NR_HAS_FIXTURE_FACTS 1
#endif
enum {NR_FLOOR,NR_POLICY,NR_RESOURCES,NR_OUTBOX,NR_RECEIPTS,NR_PH_POLICY,NR_PH_RESOURCES,NR_PH_RECEIPTS,NR_POOL_IDENTITY,NR_IO_BINDING,NR_TABLE_COUNT};
enum {NR_INSERT=1,NR_UPDATE=2};
static const char *nr_tables[]={"root_resource_floor","root_resource_policy","root_resources","root_launch_outbox","root_resource_receipts","root_physical_policy","root_physical_resources","root_physical_receipts","root_pool_identity","root_pool_io_binding"};
static const int nr_counts[]={6,8,11,3,4,8,14,4,13,12};
static const char *nr_columns[][NR_MAX_CELLS]={
 {"singleton","profile","schema_version","semantic_digest","guard_abi","issuer_epoch"},
 {"singleton","owner_digest","issuer_json","capacity","queue_limit","next_seq","human_burst","claim_seq"},
 {"record_id","execution_key","metadata_json","metadata_digest","enqueue_seq","revision","generation","issuer_epoch","state","claim_token","attempt_id"},
 {"record_id","revision","state"},
 {"record_id","kind","binding_hash","receipt_json"},
 {"kind","owner_digest","issuer_json","capacity","queue_limit","next_seq","human_burst","claim_seq"},
 {"record_id","resource_kind","execution_class","execution_key","metadata_json","metadata_digest","enqueue_seq","state","claim_token","generation","issuer_epoch","allocation_role","parent_record_id","native_root_id"},
 {"record_id","kind","binding_hash","receipt_json"},
 {"singleton","identity_version","pool_id","owner_uid","directory_device","directory_inode","directory_mode","lock_device","lock_inode","lock_mode","database_device","database_inode","database_mode"},
 {"singleton","binding_version","pool_id","namespace_id","birth_id","claim_id","anchor_digest","profile_digest","file_owner_uid","directory_nlink","lock_nlink","database_nlink"}
};
static void nr_cell_clear(nr_cell *c){free(c->bytes);memset(c,0,sizeof(*c));}
static void nr_cells_clear(nr_cell *c,int n){for(int i=0;i<n;i++)nr_cell_clear(c+i);}
static void nr_integer(nr_cell *c,sqlite3_int64 value){c->type=SQLITE_INTEGER;c->integer=value;}
static int nr_bytes(nr_cell *c,int type,const void *bytes,int length){
 c->type=type;c->length=length;if(length<0||length>1048576)return 0;
 c->bytes=malloc((size_t)length+1);if(!c->bytes)return 0;
 if(length)memcpy(c->bytes,bytes,(size_t)length);c->bytes[length]=0;return 1;
}
static int nr_text(nr_cell *c,const char *value){return nr_bytes(c,SQLITE_TEXT,value,(int)strlen(value));}
static int nr_clone(nr_cell *out,const nr_cell *in,int n){
 for(int i=0;i<n;i++){out[i].type=in[i].type;out[i].integer=in[i].integer;
  if((in[i].type==SQLITE_TEXT||in[i].type==SQLITE_BLOB)&&!nr_bytes(out+i,in[i].type,in[i].bytes,in[i].length))return 0;
 }return 1;
}
static int nr_from_column(nr_cell *out,sqlite3_stmt *stmt,int i){
 out->type=sqlite3_column_type(stmt,i);
 if(out->type==SQLITE_INTEGER)out->integer=sqlite3_column_int64(stmt,i);
 else if(out->type==SQLITE_TEXT||out->type==SQLITE_BLOB){const void *v=sqlite3_column_blob(stmt,i);int n=sqlite3_column_bytes(stmt,i);if(!v&&n)return 0;return nr_bytes(out,out->type,v,n);}
 else if(out->type!=SQLITE_NULL)return 0;
 return 1;
}
static int nr_value_equal(const nr_cell *c,sqlite3_value *value){
 int type=sqlite3_value_type(value);if(type!=(c->type?c->type:SQLITE_NULL))return 0;
 if(type==SQLITE_INTEGER)return sqlite3_value_int64(value)==c->integer;
 if(type==SQLITE_TEXT||type==SQLITE_BLOB){const void *v=sqlite3_value_blob(value);int n=sqlite3_value_bytes(value);return n==c->length&&(!n||(v&&!memcmp(v,c->bytes,(size_t)n)));}
 return type==SQLITE_NULL;
}
static int nr_column_equal(const nr_cell *c,sqlite3_stmt *stmt,int index){return nr_value_equal(c,sqlite3_column_value(stmt,index));}
static void nr_clear_frame(nr_session *s){
 for(size_t i=0;i<s->write_count;i++){nr_cells_clear(s->writes[i].old,NR_MAX_CELLS);nr_cells_clear(s->writes[i].next,NR_MAX_CELLS);}
 memset(s->writes,0,sizeof(s->writes));s->write_count=0;s->writing=0;
}
static void nr_clear_eligible(nr_session *s){while(s->eligible){nr_eligible *old=s->eligible;s->eligible=old->next;free(old);}nr_clear_frame(s);}
static nr_write *nr_expect(nr_session *s,int table,int op,const nr_cell *old,const nr_cell *next){
 if(table<0||table>=nr_table_count(s)||s->write_count==NR_MAX_WRITES)return NULL;
 nr_write *w=s->writes+s->write_count++;w->table=table;w->op=op;
 if((old&&!nr_clone(w->old,old,nr_counts[table]))||!nr_clone(w->next,next,nr_counts[table]))return NULL;return w;
}
static int nr_authorized_write(nr_session *s,int action,const char *table){
 if(!s||s->closed||s->unknown||!s->writing||!table)return 0;
 for(size_t i=0;i<s->write_count;i++){nr_write *w=s->writes+i;if(!w->seen&&!strcmp(table,nr_tables[w->table])&&((action==SQLITE_INSERT&&w->op==NR_INSERT)||(action==SQLITE_UPDATE&&w->op==NR_UPDATE)))return 1;}
 return 0;
}
static void nr_guard(nr_session *s,sqlite3_context *ctx,int argc,sqlite3_value **argv){
 int allowed=0;
 if(s&&!s->closed&&!s->unknown&&s->writing&&argc>=2&&current(s)&&sqlite3_value_type(argv[0])==SQLITE_TEXT&&sqlite3_value_type(argv[1])==SQLITE_TEXT){
  const char *table=(const char*)sqlite3_value_text(argv[0]),*op=(const char*)sqlite3_value_text(argv[1]);
  for(size_t i=0;i<s->write_count&&!allowed;i++){nr_write *w=s->writes+i;int n=nr_counts[w->table];
   if(w->seen||argc!=2+2*n||strcmp(table,nr_tables[w->table])||strcmp(op,w->op==NR_INSERT?"insert":"update"))continue;
   int good=1;for(int j=0;j<n&&good;j++)good=nr_value_equal(w->old+j,argv[2+j])&&nr_value_equal(w->next+j,argv[2+n+j]);
   if(good){w->seen=1;allowed=1;}
  }
 }sqlite3_result_int(ctx,allowed);
}
static int nr_bind(sqlite3_stmt *stmt,int index,const nr_cell *c){
 switch(c->type){case SQLITE_INTEGER:return sqlite3_bind_int64(stmt,index,c->integer)==SQLITE_OK;
 case SQLITE_TEXT:return sqlite3_bind_text(stmt,index,(const char*)c->bytes,c->length,SQLITE_TRANSIENT)==SQLITE_OK;
 case SQLITE_BLOB:return sqlite3_bind_blob(stmt,index,c->bytes,c->length,SQLITE_TRANSIENT)==SQLITE_OK;
 case 0:case SQLITE_NULL:return sqlite3_bind_null(stmt,index)==SQLITE_OK;default:return 0;}
}
static int nr_append(char *sql,size_t capacity,size_t *used,const char *value){int n=snprintf(sql+*used,capacity-*used,"%s",value);if(n<0||(size_t)n>=capacity-*used)return 0;*used+=(size_t)n;return 1;}
static int nr_run_write(nr_session *s,nr_write *w){
 char sql[4096];size_t used=0;int n=nr_counts[w->table],good=1;
 if(w->op==NR_INSERT){good=nr_append(sql,sizeof(sql),&used,"INSERT INTO ")&&nr_append(sql,sizeof(sql),&used,nr_tables[w->table])&&nr_append(sql,sizeof(sql),&used," VALUES(");
  for(int i=0;i<n&&good;i++)good=nr_append(sql,sizeof(sql),&used,i?",?":"?");if(good)good=nr_append(sql,sizeof(sql),&used,")");
 }else{good=nr_append(sql,sizeof(sql),&used,"UPDATE ")&&nr_append(sql,sizeof(sql),&used,nr_tables[w->table])&&nr_append(sql,sizeof(sql),&used," SET ");
  for(int i=0;i<n&&good;i++)good=(!i||nr_append(sql,sizeof(sql),&used,","))&&nr_append(sql,sizeof(sql),&used,nr_columns[w->table][i])&&nr_append(sql,sizeof(sql),&used,"=?");
  if(good)good=nr_append(sql,sizeof(sql),&used," WHERE ");
  for(int i=0;i<n&&good;i++)good=(!i||nr_append(sql,sizeof(sql),&used," AND "))&&nr_append(sql,sizeof(sql),&used,nr_columns[w->table][i])&&nr_append(sql,sizeof(sql),&used," IS ?");
 }
 sqlite3_stmt *stmt=NULL;if(good)good=sqlite3_prepare_v2(s->db,sql,-1,&stmt,NULL)==SQLITE_OK;
 for(int i=0;i<n&&good;i++)good=nr_bind(stmt,i+1,w->next+i);
 if(w->op==NR_UPDATE)for(int i=0;i<n&&good;i++)good=nr_bind(stmt,n+i+1,w->old+i);
#ifdef NR_HAS_FIXTURE_FACTS
 /* Actual SQL binding differs from the original private expected write. The
  * real full-cell guard must reject it; this never invokes caller code. */
 if(good&&s->fixture_cell_mismatch&&w->table==NR_PH_RESOURCES&&w->op==NR_UPDATE){
  int column=s->fixture_cell_mismatch;s->fixture_cell_mismatch=0;
  good=sqlite3_bind_text(stmt,column,"fixture-wrong-cell",-1,SQLITE_STATIC)==SQLITE_OK;
 }
#endif
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE&&sqlite3_changes(s->db)==1&&w->seen;
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;return good;
}
static int nr_readback(nr_session *s,nr_write *w){
 char sql[2048];size_t used=0;int n=nr_counts[w->table],good=nr_append(sql,sizeof(sql),&used,"SELECT ");
 for(int i=0;i<n&&good;i++)good=(!i||nr_append(sql,sizeof(sql),&used,","))&&nr_append(sql,sizeof(sql),&used,nr_columns[w->table][i]);
 good=good&&nr_append(sql,sizeof(sql),&used," FROM ")&&nr_append(sql,sizeof(sql),&used,nr_tables[w->table])&&nr_append(sql,sizeof(sql),&used," WHERE ")&&nr_append(sql,sizeof(sql),&used,nr_columns[w->table][0])&&nr_append(sql,sizeof(sql),&used," IS ?");
 if((w->table==NR_RECEIPTS||w->table==NR_PH_RECEIPTS))good=good&&nr_append(sql,sizeof(sql),&used," AND kind IS ?");
 sqlite3_stmt *stmt=NULL;if(good)good=sqlite3_prepare_v2(s->db,sql,-1,&stmt,NULL)==SQLITE_OK&&nr_bind(stmt,1,w->next);
 if(good&&(w->table==NR_RECEIPTS||w->table==NR_PH_RECEIPTS))good=nr_bind(stmt,2,w->next+1);
 if(good)good=sqlite3_step(stmt)==SQLITE_ROW;
 for(int i=0;i<n&&good;i++)good=nr_column_equal(w->next+i,stmt,i);
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;return good;
}
static int nr_verify_frame(nr_session *s){for(size_t i=0;i<s->write_count;i++)if(!s->writes[i].seen||!nr_readback(s,s->writes+i))return 0;return 1;}
static int nr_create_guards(nr_session *s){
 const char *ops[]={"INSERT","UPDATE","DELETE"},*names[]={"insert","update","delete"};
 for(int t=0;t<nr_table_count(s);t++)for(int op=0;op<3;op++){
  char sql[8192],prefix[512];size_t used=0;int n=snprintf(prefix,sizeof(prefix),"CREATE TRIGGER nr_guard_%d_%d BEFORE %s ON %s WHEN %s('%s','%s'",t,op,ops[op],nr_tables[t],nr_guard_name(s),nr_tables[t],names[op]);
  int good=n>0&&(size_t)n<sizeof(prefix)&&nr_append(sql,sizeof(sql),&used,prefix);
  for(int side=0;side<2&&good;side++)for(int i=0;i<nr_counts[t]&&good;i++){
   good=nr_append(sql,sizeof(sql),&used,",");
   if((side==0&&op==0)||(side==1&&op==2))good=good&&nr_append(sql,sizeof(sql),&used,"NULL");
   else good=good&&nr_append(sql,sizeof(sql),&used,side?"NEW.":"OLD.")&&nr_append(sql,sizeof(sql),&used,nr_columns[t][i]);
  }
  good=good&&nr_append(sql,sizeof(sql),&used,") IS NOT 1 BEGIN SELECT RAISE(ABORT,'root_resource_writer_forbidden'); END;");
  if(!good||!execute(s,sql))return 0;
 }return 1;
}
static int nr_install_write(nr_session *s,nr_write *w){
 int good=nr_run_write(s,w);
#ifdef NR_FIXTURE_BUILD
 if(good&&s->fixture_bootstrap_failure>0&&s->fixture_bootstrap_failure<6&&!--s->fixture_bootstrap_failure)return 0;
#endif
 return good;
}
static int nr_install_rows(nr_session *s){
 nr_cell floor[NR_MAX_CELLS]={0},policy[NR_MAX_CELLS]={0};
 nr_integer(floor,1);nr_integer(floor+2,nr_schema_version(s));nr_integer(floor+5,1);
 int good=nr_text(floor+1,nr_profile(s))&&nr_text(floor+3,nr_digest(s))&&nr_text(floor+4,nr_guard_name(s));
 nr_integer(policy,1);nr_integer(policy+3,5);nr_integer(policy+4,256);nr_integer(policy+5,0);nr_integer(policy+6,0);nr_integer(policy+7,0);
 good=good&&nr_text(policy+1,"native-reservation-component")&&nr_text(policy+2,"{\"build\":\"reservation-writer\"}");
 nr_write *f=good?nr_expect(s,NR_FLOOR,NR_INSERT,NULL,floor):NULL,*p=f?nr_expect(s,NR_POLICY,NR_INSERT,NULL,policy):NULL;
 good=p&&nr_install_write(s,f)&&nr_install_write(s,p);
 for(int kind=1;good&&kind<=2;kind++){
  nr_cell physical[NR_MAX_CELLS]={0};
  nr_integer(physical,kind);nr_integer(physical+3,kind==1?4:2);nr_integer(physical+4,256);
  nr_integer(physical+5,0);nr_integer(physical+6,0);nr_integer(physical+7,0);
  good=nr_text(physical+1,"native-physical-component")&&nr_text(physical+2,"{\"profile\":\"M4-P2\"}");
  nr_write *write=good?nr_expect(s,NR_PH_POLICY,NR_INSERT,NULL,physical):NULL;
  good=write&&nr_install_write(s,write);nr_cells_clear(physical,NR_MAX_CELLS);
 }
nr_cells_clear(floor,NR_MAX_CELLS);nr_cells_clear(policy,NR_MAX_CELLS);return good&&nr_install_pool_identity(s);
}

typedef struct {
 char id[257],key[257],digest[65],state[32],claim[257],attempt[257];
 char *metadata;sqlite3_int64 seq,revision,generation,epoch,outbox;
} nr_record;
typedef struct nr_child {
 struct nr_child *next;nr_session *parent;napi_env env;napi_ref parent_ref,receipt_ref;
 struct nr_leaf *leaf;
 int kind,valid,priority,has_deadline,source_kind,physical_kind;napi_ref source_ref;sqlite3_int64 deadline;nr_record record;
} nr_child;
enum {NR_SUBJECT=1,NR_RESERVATION=2,NR_RECEIPT=3,NR_ROOM_DISCUSSION_KEY=4,NR_ROOM_PROJECT_KEY=5,NR_KSWARM_DIRECT_KEY=6,NR_WORKFLOW_ROOT_KEY=7,NR_DSH_DRAFT_KEY=8,NR_NESTED_KEY=9,NR_ADMISSION_KEY=10,NR_PREVIEW_KEY=11,NR_SNAPSHOT_KEY=12,NR_TOOL_KEY=13,NR_MAIN_KEY=14,NR_GOAL_KEY=15,NR_MATERIAL_KEY=16,NR_CANVAS_KEY=17,NR_CONTEXT=18,NR_MODEL_PERMIT=19,NR_PROCESS_PERMIT=20,NR_MODEL_SDK_BRIDGE=21,NR_LEAF_READY=22};
static const napi_type_tag nr_child_tag={0x013fba3584661723ULL,0x84a11d308cc924efULL};
static _Thread_local nr_child *nr_children;
static void nr_record_clear(nr_record *r){free(r->metadata);memset(r,0,sizeof(*r));}
static int nr_hash(const char *value,char out[65]){
 unsigned char bytes[CC_SHA256_DIGEST_LENGTH];size_t n=strlen(value);if(n>1048576||!CC_SHA256(value,(CC_LONG)n,bytes))return 0;
 static const char hex[]="0123456789abcdef";for(size_t i=0;i<sizeof(bytes);i++){out[2*i]=hex[bytes[i]>>4];out[2*i+1]=hex[bytes[i]&15];}out[64]=0;return 1;
}
static void nr_nonce(char out[65]){unsigned char bytes[32];arc4random_buf(bytes,sizeof(bytes));static const char hex[]="0123456789abcdef";for(size_t i=0;i<sizeof(bytes);i++){out[2*i]=hex[bytes[i]>>4];out[2*i+1]=hex[bytes[i]&15];}out[64]=0;}
static void nr_hex32(const unsigned char bytes[32],char out[65]){static const char hex[]="0123456789abcdef";for(int i=0;i<32;i++){out[2*i]=hex[bytes[i]>>4];out[2*i+1]=hex[bytes[i]&15];}out[64]=0;}
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
static int nr_install_protected_identity(nr_session *s){
 nr_root_store_identity identity;if(!s->io_claim||!nr_root_store_read_claim(s->root_io,s->io_claim,&identity)||identity.birth_state!=NR_CLAIMED)return 0;
 nr_cell row[NR_MAX_CELLS]={0},binding[NR_MAX_CELLS]={0};char text[65];nr_integer(row,1);nr_integer(row+1,2);
 nr_hex32(identity.pool_id,text);int good=nr_text(row+2,text);nr_integer(row+3,identity.main_principal_uid);
 const nr_root_file_fact *facts[]={&identity.directory,&identity.issuer_lock,&identity.database};
 for(int i=0;i<3;i++){nr_integer(row+4+3*i,(sqlite3_int64)facts[i]->device);nr_integer(row+5+3*i,(sqlite3_int64)facts[i]->inode);nr_integer(row+6+3*i,facts[i]->mode);}
 nr_integer(binding,1);nr_integer(binding+1,2);
 const unsigned char *ids[]={identity.pool_id,identity.namespace_id,identity.birth_id,identity.claim_id,identity.anchor_digest,identity.profile_digest};
 for(int i=0;i<6&&good;i++){nr_hex32(ids[i],text);good=nr_text(binding+2+i,text);}
 nr_integer(binding+8,identity.file_owner_uid);nr_integer(binding+9,(sqlite3_int64)identity.directory.nlink);nr_integer(binding+10,(sqlite3_int64)identity.issuer_lock.nlink);nr_integer(binding+11,(sqlite3_int64)identity.database.nlink);
 nr_write *a=good?nr_expect(s,NR_POOL_IDENTITY,NR_INSERT,NULL,row):NULL,*b=a?nr_expect(s,NR_IO_BINDING,NR_INSERT,NULL,binding):NULL;
 good=b&&nr_install_write(s,a)&&nr_install_write(s,b);nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(binding,NR_MAX_CELLS);return good;
}
#endif
static int nr_install_pool_identity(nr_session *s){
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(s->root_io)return nr_install_protected_identity(s);
#endif
 nr_cell row[NR_MAX_CELLS]={0};char id[65];nr_nonce(id);
 nr_integer(row,1);nr_integer(row+1,1);int good=nr_text(row+2,id);
 nr_integer(row+3,(sqlite3_int64)geteuid());
 const struct stat *stats[]={&s->directory_identity,&s->lock_identity,&s->database_identity};
 for(int i=0;i<3&&good;i++){
  good=(uint64_t)stats[i]->st_dev<=INT64_MAX&&(uint64_t)stats[i]->st_ino<=INT64_MAX;
  nr_integer(row+4+3*i,(sqlite3_int64)stats[i]->st_dev);
  nr_integer(row+5+3*i,(sqlite3_int64)stats[i]->st_ino);
  nr_integer(row+6+3*i,(sqlite3_int64)stats[i]->st_mode);
 }
 nr_write *w=good?nr_expect(s,NR_POOL_IDENTITY,NR_INSERT,NULL,row):NULL;
 good=w&&nr_install_write(s,w);nr_cells_clear(row,NR_MAX_CELLS);return good;
}
static int nr_string_column(sqlite3_stmt *stmt,int column,char *out,size_t capacity,int nullable){
 if(sqlite3_column_type(stmt,column)==SQLITE_NULL){if(!nullable)return 0;out[0]=0;return 1;}
 if(sqlite3_column_type(stmt,column)!=SQLITE_TEXT)return 0;const unsigned char *value=sqlite3_column_text(stmt,column);int n=sqlite3_column_bytes(stmt,column);
 if(!value||n<=0||(size_t)n>=capacity||memchr(value,0,(size_t)n))return 0;memcpy(out,value,(size_t)n);out[n]=0;return 1;
}
static int nr_active(const char *state){return !strcmp(state,"reserved")||!strcmp(state,"running")||!strcmp(state,"cancel_pending")||!strcmp(state,"launch_unknown");}
static const char *nr_select_record="SELECT r.*,o.revision FROM root_resources r LEFT JOIN root_launch_outbox o ON o.record_id=r.record_id";
static int nr_decode_record(sqlite3_stmt *stmt,nr_record *r){
 int good=nr_string_column(stmt,0,r->id,sizeof(r->id),0)&&nr_string_column(stmt,1,r->key,sizeof(r->key),0)&&nr_string_column(stmt,3,r->digest,sizeof(r->digest),0)&&nr_string_column(stmt,8,r->state,sizeof(r->state),0)&&nr_string_column(stmt,9,r->claim,sizeof(r->claim),1)&&nr_string_column(stmt,10,r->attempt,sizeof(r->attempt),1);
 if(!good||sqlite3_column_type(stmt,2)!=SQLITE_TEXT)return 0;
 int size=sqlite3_column_bytes(stmt,2);const unsigned char *json=sqlite3_column_text(stmt,2);if(!json||size<=0||size>1048576||memchr(json,0,(size_t)size))return 0;
 r->metadata=malloc((size_t)size+1);if(!r->metadata)return 0;memcpy(r->metadata,json,(size_t)size);r->metadata[size]=0;
 char digest[65];if(!nr_hash(r->metadata,digest)||strcmp(digest,r->digest))return 0;
 sqlite3_int64 *numbers[]={&r->seq,&r->revision,&r->generation,&r->epoch};
 for(int i=0;i<4;i++){if(sqlite3_column_type(stmt,4+i)!=SQLITE_INTEGER)return 0;*numbers[i]=sqlite3_column_int64(stmt,4+i);if(*numbers[i]<0||*numbers[i]>NR_MAX_SAFE)return 0;}
 if(r->seq<1||r->revision<1||r->epoch!=1)return 0;
 if(sqlite3_column_type(stmt,11)==SQLITE_NULL)r->outbox=-1;
 else{if(sqlite3_column_type(stmt,11)!=SQLITE_INTEGER)return 0;r->outbox=sqlite3_column_int64(stmt,11);if(r->outbox<0||r->outbox>NR_MAX_SAFE)return 0;}
 if(nr_active(r->state)||!strcmp(r->state,"released"))return r->claim[0]&&r->attempt[0]&&r->generation==1&&r->outbox>=0;
 return (!strcmp(r->state,"queued")||!strcmp(r->state,"cancelled_before_launch"))&&!r->claim[0]&&!r->attempt[0]&&r->generation==0&&r->outbox==-1;
}
/* 1 = one exact row, 0 = absent, -1 = Native/shape failure. */
static int nr_read(nr_session *s,const char *key,nr_record *r){
 char sql[512];snprintf(sql,sizeof(sql),"%s WHERE r.execution_key=?",nr_select_record);sqlite3_stmt *stmt=NULL;int result=-1;
 if(sqlite3_prepare_v2(s->db,sql,-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_text(stmt,1,key,-1,SQLITE_TRANSIENT)==SQLITE_OK){
  int step=sqlite3_step(stmt);if(step==SQLITE_DONE)result=0;
  else if(step==SQLITE_ROW&&nr_decode_record(stmt,r)&&sqlite3_step(stmt)==SQLITE_DONE)result=1;
 }if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)result=-1;if(result!=1)nr_record_clear(r);return result;
}
static int nr_record_cells(const nr_record *r,nr_cell *cells){
 nr_integer(cells+4,r->seq);nr_integer(cells+5,r->revision);nr_integer(cells+6,r->generation);nr_integer(cells+7,r->epoch);
 return nr_text(cells,r->id)&&nr_text(cells+1,r->key)&&nr_text(cells+2,r->metadata)&&nr_text(cells+3,r->digest)&&nr_text(cells+8,r->state)&&(!r->claim[0]||nr_text(cells+9,r->claim))&&(!r->attempt[0]||nr_text(cells+10,r->attempt));
}
static int nr_projection(napi_env env,napi_value out,const nr_record *r){
 return text(env,out,"recordId",r->id)&&text(env,out,"executionKey",r->key)&&text(env,out,"metadataJson",r->metadata)&&text(env,out,"metadataDigest",r->digest)&&text(env,out,"state",r->state)&&number(env,out,"enqueueSeq",r->seq)&&number(env,out,"revision",r->revision)&&number(env,out,"acquireGeneration",r->generation)&&number(env,out,"issuerEpoch",r->epoch)&&number(env,out,"outboxRevision",r->outbox<0?0:r->outbox)&&(!r->claim[0]||text(env,out,"claimToken",r->claim))&&(!r->attempt[0]||text(env,out,"attemptId",r->attempt));
}
static void nr_child_finalize(napi_env env,void *raw,void *hint){
 (void)hint;nr_child *c=raw;
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
 if(c->kind==NR_PROCESS_PERMIT&&c->leaf)nr_leaf_dispose(env,c->leaf);
#endif
 nr_child **slot=&nr_children;while(*slot&&*slot!=c)slot=&(*slot)->next;if(*slot)*slot=c->next;
 if(c->source_ref)napi_delete_reference(env,c->source_ref);
 if(c->receipt_ref)napi_delete_reference(env,c->receipt_ref);nr_record_clear(&c->record);if(c->parent_ref)napi_delete_reference(env,c->parent_ref);free(c);
}
static nr_child *nr_new_child(napi_env env,napi_value parent,nr_session *s,int kind,napi_value *out){
 nr_child *c=calloc(1,sizeof(*c));if(!c)return NULL;c->parent=s;c->env=env;c->kind=kind;
 if(napi_create_object(env,out)!=napi_ok||napi_type_tag_object(env,*out,&nr_child_tag)!=napi_ok||napi_create_reference(env,parent,1,&c->parent_ref)!=napi_ok){if(c->parent_ref)napi_delete_reference(env,c->parent_ref);free(c);return NULL;}
 if(napi_wrap(env,*out,c,nr_child_finalize,NULL,NULL)!=napi_ok){napi_delete_reference(env,c->parent_ref);free(c);return NULL;}
 c->next=nr_children;nr_children=c;if(napi_object_freeze(env,*out)!=napi_ok)return NULL;return c;
}
static nr_child *nr_get_child(napi_env env,napi_value value,nr_session *s,int kind){
 bool tag=false,is_null=false;napi_valuetype type;napi_value null_value;nr_child *candidate=NULL;
 if(napi_typeof(env,value,&type)!=napi_ok||type!=napi_object||napi_get_null(env,&null_value)!=napi_ok||napi_strict_equals(env,value,null_value,&is_null)!=napi_ok||is_null)return NULL;
 if(napi_check_object_type_tag(env,value,&nr_child_tag,&tag)!=napi_ok||!tag||napi_unwrap(env,value,(void**)&candidate)!=napi_ok)return NULL;
 for(nr_child *c=nr_children;c;c=c->next)if(c==candidate)return c->env==env&&c->parent==s&&c->kind==kind&&c->valid?c:NULL;return NULL;
}
static napi_value nr_error(napi_env env,nr_session *s,const char *message,int primary,int extended,int committed){
 s->unknown=1;bool pending=false;if(napi_is_exception_pending(env,&pending)!=napi_ok||pending)return NULL;
 napi_value msg,error;if(napi_create_string_utf8(env,message,NAPI_AUTO_LENGTH,&msg)!=napi_ok||napi_create_error(env,NULL,msg,&error)!=napi_ok)return fail(env,message);
 number(env,error,"sqliteCode",primary);number(env,error,"sqliteExtendedCode",extended);if(committed)boolean(env,error,"durableCommitted",1);napi_throw(env,error);return NULL;
}
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
/* These keys authenticate only one original Main role/session/class slot.
 * Actual TS owner/accepted-work membership is deliberately not inferred here. */
static napi_value take_source_key(napi_env env,napi_callback_info info,int kind,unsigned slot){
 napi_value args[2],out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 if(s->business_sealed)return fail(env,"ROOT_RESOURCE_BUSINESS_SEALED");
 if(!main_session_current(env,s))return NULL;
 if(s->source_key_slots&slot)return fail(env,"ROOT_RESOURCE_SOURCE_KEY_ALREADY_ISSUED");
 /* Reserve before the first key construction SDK. Never refund this slot on
  * projection failure, GC or role revocation. Parent owns no back-reference. */
 s->source_key_slots|=slot;
 nr_child *key=nr_new_child(env,args[0],s,kind,&out);
 if(!key)return nr_error(env,s,"ROOT_RESOURCE_SOURCE_KEY_UNCONFIRMED",0,0,0);
 if(!main_session_current(env,s)){s->unknown=1;return NULL;}
 key->valid=1;return out;
}
static napi_value assert_source_key(napi_env env,napi_callback_info info,int kind){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=main_session_member(env,info,args[0]);if(!s)return NULL;
 /* Wrong class, copied/proxy/foreign key: reject before any role/FS SDK. */
 if(!nr_get_child(env,args[1],s,kind))return fail(env,"ROOT_RESOURCE_SOURCE_KEY_REQUIRED");
 if(!main_session_current(env,s))return NULL;
 if(napi_get_undefined(env,&out)!=napi_ok)return nr_error(env,s,"ROOT_RESOURCE_SOURCE_KEY_UNCONFIRMED",0,0,0);
 return out;
}
#define NR_FIXED_SOURCE_KEY(name,kind,slot) \
 static napi_value take_##name##_source_key(napi_env env,napi_callback_info info){return take_source_key(env,info,kind,slot);} \
 static napi_value assert_##name##_source_key(napi_env env,napi_callback_info info){return assert_source_key(env,info,kind);}
NR_FIXED_SOURCE_KEY(room_discussion,NR_ROOM_DISCUSSION_KEY,1u)
NR_FIXED_SOURCE_KEY(room_project,NR_ROOM_PROJECT_KEY,2u)
NR_FIXED_SOURCE_KEY(kswarm_direct,NR_KSWARM_DIRECT_KEY,4u)
NR_FIXED_SOURCE_KEY(workflow_root,NR_WORKFLOW_ROOT_KEY,8u)
NR_FIXED_SOURCE_KEY(dsh_draft,NR_DSH_DRAFT_KEY,16u)
NR_FIXED_SOURCE_KEY(nested_subagent,NR_NESTED_KEY,32u)
NR_FIXED_SOURCE_KEY(admission_probe,NR_ADMISSION_KEY,64u)
NR_FIXED_SOURCE_KEY(live_preview,NR_PREVIEW_KEY,128u)
NR_FIXED_SOURCE_KEY(snapshot_prep,NR_SNAPSHOT_KEY,256u)
NR_FIXED_SOURCE_KEY(tool_worker,NR_TOOL_KEY,512u)
NR_FIXED_SOURCE_KEY(main_turn,NR_MAIN_KEY,1024u)
NR_FIXED_SOURCE_KEY(goal_turn,NR_GOAL_KEY,2048u)
NR_FIXED_SOURCE_KEY(material_turn,NR_MATERIAL_KEY,4096u)
NR_FIXED_SOURCE_KEY(canvas_turn,NR_CANVAS_KEY,8192u)
#undef NR_FIXED_SOURCE_KEY
#include "room-subject.h"
#include "dsh-subject.h"
#include "business-subjects.h"
#endif
static napi_value nr_abort(napi_env env,nr_session *s,const char *message,int began,int committed){
 int primary=sqlite3_errcode(s->db),extended=sqlite3_extended_errcode(s->db);if(began&&!committed)execute(s,"ROLLBACK");nr_clear_frame(s);return nr_error(env,s,message,primary,extended,committed);
}
/* Only an explicitly recognized, pre-write business refusal may leave this
 * issuer healthy. Failure of the actual rollback/floor/identity remains an
 * unconfirmed Native operation, never a successful protocol rejection. */
static napi_value nr_known_rejection(napi_env env,nr_session *s,const char *message,int began){
 int good=began&&!s->closed&&!s->unknown&&s->writing&&s->write_count==0&&sqlite3_get_autocommit(s->db)==0;
 if(good)good=execute(s,"ROLLBACK")&&sqlite3_get_autocommit(s->db)==1;
 int primary=sqlite3_errcode(s->db),extended=sqlite3_extended_errcode(s->db);nr_clear_frame(s);
 if(!good)return nr_error(env,s,message,primary,extended,0);
 if(!floor_valid(s)||!current(s)||s->closed||s->unknown)return nr_error(env,s,message,sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);
 return fail(env,message);
}
static int nr_begin(nr_session *s){if(s->writing||s->write_count)return 0;s->writing=1;return execute(s,"BEGIN IMMEDIATE");}
static int nr_commit(nr_session *s){return nr_verify_frame(s)&&floor_valid(s)&&current(s)&&execute(s,"COMMIT");}
static int nr_local_current(nr_session *s){return !s->closed&&!s->unknown&&s->fresh_owner&&current(s);}
static int nr_policy(nr_session *s,nr_cell *out){
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT * FROM root_resource_policy WHERE singleton=1",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_step(stmt)==SQLITE_ROW;
 for(int i=0;i<8&&good;i++)good=nr_from_column(out+i,stmt,i);
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 if(good)good=out[0].type==SQLITE_INTEGER&&out[0].integer==1&&out[1].type==SQLITE_TEXT&&out[2].type==SQLITE_TEXT&&out[3].type==SQLITE_INTEGER&&out[3].integer==5&&out[4].type==SQLITE_INTEGER&&out[4].integer==256;
 for(int i=5;i<8&&good;i++)good=out[i].type==SQLITE_INTEGER&&out[i].integer>=0&&out[i].integer<=NR_MAX_SAFE;
 return good&&out[6].integer<=3;
}
static napi_value nr_null(napi_env env){napi_value out=NULL;napi_get_null(env,&out);return out;}
static int nr_key(napi_env env,napi_value value,char out[257]){
 napi_valuetype type;size_t size=0;return napi_typeof(env,value,&type)==napi_ok&&type==napi_string&&napi_get_value_string_utf8(env,value,NULL,0,&size)==napi_ok&&size>0&&size<=256&&napi_get_value_string_utf8(env,value,out,257,&size)==napi_ok&&!memchr(out,0,size);
}
#ifdef NR_HAS_FIXTURE_FACTS
static int nr_fact(size_t index,nr_record *record,int *priority,int *has_deadline,sqlite3_int64 *deadline,nr_session *s){
 if(index>=NR_FIXTURE_FACT_COUNT)return 0;const char *metadata=nr_fixture_metadata[index],*key=nr_fixture_execution_keys[index];size_t size=strlen(metadata),length=strlen(key);
 if(!length||length>256||!size||size>1048576||(nr_fixture_priorities[index]!=0&&nr_fixture_priorities[index]!=1))return 0;
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT json_valid(?1),json_extract(?1,'$.executionKey'),json_extract(?1,'$.priorityClass'),json_type(?1,'$.deadlineAt'),json_extract(?1,'$.deadlineAt')",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_text(stmt,1,metadata,-1,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(stmt)==SQLITE_ROW&&sqlite3_column_int(stmt,0)==1;
 if(good){const char *actual=(const char*)sqlite3_column_text(stmt,1),*p=(const char*)sqlite3_column_text(stmt,2),*dt=(const char*)sqlite3_column_text(stmt,3);good=actual&&!strcmp(actual,key)&&p&&!strcmp(p,nr_fixture_priorities[index]?"human_followup":"background");
  *has_deadline=dt!=NULL;if(*has_deadline){good=good&&!strcmp(dt,"integer")&&sqlite3_column_type(stmt,4)==SQLITE_INTEGER;*deadline=sqlite3_column_int64(stmt,4);good=good&&*deadline>=0&&*deadline<=NR_MAX_SAFE;}
 }
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 if(!good)return 0;memcpy(record->key,key,length+1);record->metadata=strdup(metadata);*priority=nr_fixture_priorities[index];return record->metadata&&nr_hash(metadata,record->digest);
}
static napi_value fixture_subject(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 napi_valuetype type;double index;if(napi_typeof(env,args[1],&type)!=napi_ok||type!=napi_number||napi_get_value_double(env,args[1],&index)!=napi_ok||!(index>=0&&index<NR_FIXTURE_FACT_COUNT)||index!=(double)(size_t)index)return fail(env,"ROOT_RESOURCE_SUBJECT_INDEX_INVALID");
 nr_child *c=nr_new_child(env,args[0],s,NR_SUBJECT,&out);if(!c)return nr_error(env,s,"ROOT_RESOURCE_SUBJECT_UNCONFIRMED",0,0,0);
 if(!nr_fact((size_t)index,&c->record,&c->priority,&c->has_deadline,&c->deadline,s)||!nr_local_current(s))return nr_error(env,s,"ROOT_RESOURCE_SUBJECT_UNCONFIRMED",sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);
 c->valid=1;return out;
}
/* Finite fixture SDK wrapper seam. It neither runs caller code nor changes
 * SQLite's result: the actual COMMIT has already returned SQLITE_OK. */
static napi_value arm_commit_wrapper_failure(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 if(!s->fresh_owner||s->writing||s->fixture_commit_failure)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_UNAVAILABLE");
 char kind[257];if(!nr_key(env,args[1],kind)|| (strcmp(kind,"claim")&&strcmp(kind,"consume")&&strcmp(kind,"cancel")&&strcmp(kind,"physical_claim")&&strcmp(kind,"physical_settle")))return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_INVALID");
 s->fixture_commit_failure=!strcmp(kind,"claim")?1:!strcmp(kind,"consume")?2:!strcmp(kind,"cancel")?3:!strcmp(kind,"physical_claim")?4:5;napi_get_undefined(env,&out);return out;
}
static napi_value arm_physical_write_mismatch(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 if(!s->fresh_owner||s->writing||s->fixture_cell_mismatch)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_UNAVAILABLE");
 char column[257];if(!nr_key(env,args[1],column))return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_INVALID");
 int index=!strcmp(column,"allocation_role")?12:!strcmp(column,"parent_record_id")?13:!strcmp(column,"native_root_id")?14:0;
 if(!index)return fail(env,"ROOT_RESOURCE_FIXTURE_ARM_INVALID");
 s->fixture_cell_mismatch=index;napi_get_undefined(env,&out);return out;
}
#endif
static int nr_fixture_commit_failed(nr_session *s,int kind){
#ifdef NR_HAS_FIXTURE_FACTS
 if(s->fixture_commit_failure==kind){s->fixture_commit_failure=0;return 1;}
#else
 (void)s;(void)kind;
#endif
 return 0;
}

static napi_value enqueue_resource(napi_env env,napi_callback_info info){
 napi_value args[3];if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 nr_child *subject=nr_get_child(env,args[1],s,NR_SUBJECT);if(!subject)return fail(env,"ROOT_RESOURCE_SUBJECT_REQUIRED");
 napi_value out=object(env),record_out=object(env);nr_eligible *eligible=calloc(1,sizeof(*eligible));
 if(!out||!record_out||!eligible){free(eligible);return nr_error(env,s,"ROOT_RESOURCE_ENQUEUE_UNCONFIRMED",0,0,0);}
 nr_record candidate={0},record={0};nr_cell policy[NR_MAX_CELLS]={0},next_policy[NR_MAX_CELLS]={0},cells[NR_MAX_CELLS]={0};
 int began=0,committed=0,known_rejection=0;const char *disposition=NULL,*error="ROOT_RESOURCE_ENQUEUE_UNCONFIRMED";
 /* The subject constructor alone imports external facts. This original
  * enqueue kernel is compiled identically for production and fixture targets. */
 if(!subject->record.metadata||(subject->priority!=0&&subject->priority!=1))goto bad;
 memcpy(candidate.key,subject->record.key,sizeof(candidate.key));memcpy(candidate.digest,subject->record.digest,sizeof(candidate.digest));candidate.metadata=strdup(subject->record.metadata);if(!candidate.metadata)goto bad;
 if(!nr_local_current(s)||!floor_valid(s))goto bad;
 began=nr_begin(s);if(!began)goto bad;
 int found=nr_read(s,candidate.key,&record);if(found<0||!nr_policy(s,policy))goto bad;
 if(found){if(strcmp(record.digest,candidate.digest)){error="ROOT_RESOURCE_INPUT_CONFLICT";known_rejection=1;goto bad;}disposition=!strcmp(record.state,"queued")?"existing_queued":nr_active(record.state)?"existing_active":"existing_terminal";}
 else{
  sqlite3_int64 queued=0;if(!scalar(s->db,"SELECT count(*) FROM root_resources WHERE state='queued'",&queued))goto bad;
  if(queued>=policy[4].integer){error="ROOT_RESOURCE_QUEUE_CAPACITY_REQUIRED";known_rejection=1;goto bad;}
  if(policy[5].integer==NR_MAX_SAFE){error="ROOT_RESOURCE_SEQUENCE_OVERFLOW";goto bad;}
  nr_nonce(candidate.id);candidate.seq=policy[5].integer+1;candidate.revision=1;candidate.epoch=1;candidate.outbox=-1;strcpy(candidate.state,"queued");
  if(!nr_record_cells(&candidate,cells)||!nr_clone(next_policy,policy,8))goto bad;next_policy[5].integer=candidate.seq;
  nr_write *resource=nr_expect(s,NR_RESOURCES,NR_INSERT,NULL,cells),*p=resource?nr_expect(s,NR_POLICY,NR_UPDATE,policy,next_policy):NULL;
  if(!p||!nr_run_write(s,resource)||!nr_run_write(s,p))goto bad;
  if(nr_read(s,candidate.key,&record)!=1)goto bad;
  memcpy(eligible->record_id,record.id,strlen(record.id)+1);memcpy(eligible->digest,record.digest,65);eligible->seq=record.seq;eligible->priority=subject->priority;eligible->has_deadline=subject->has_deadline;eligible->deadline=subject->deadline;disposition="new_queued";
 }
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);
 if(!nr_projection(env,record_out,&record)||!text(env,out,"disposition",disposition)||!own_data(env,out,"record",record_out)||!nr_local_current(s))goto bad;
 if(!strcmp(disposition,"new_queued")){eligible->next=s->eligible;s->eligible=eligible;eligible=NULL;}
 nr_record_clear(&record);nr_record_clear(&candidate);nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);nr_cells_clear(cells,NR_MAX_CELLS);free(eligible);return out;
bad:
 nr_record_clear(&record);nr_record_clear(&candidate);nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);nr_cells_clear(cells,NR_MAX_CELLS);free(eligible);return known_rejection?nr_known_rejection(env,s,error,began):nr_abort(env,s,error,began,committed);
}
static nr_eligible *nr_eligible_row(nr_session *s,const nr_record *record,sqlite3_int64 now){
 for(nr_eligible *e=s->eligible;e;e=e->next)if(!strcmp(e->record_id,record->id)&&!strcmp(e->digest,record->digest)&&e->seq==record->seq&&(!e->has_deadline||e->deadline>now))return e;return NULL;
}
static int nr_select_eligible(nr_session *s,int burst,nr_record *out,int *priority){
 struct timespec time;if(clock_gettime(CLOCK_REALTIME,&time)||time.tv_sec<0||time.tv_sec>NR_MAX_SAFE/1000)return 0;sqlite3_int64 now=(sqlite3_int64)time.tv_sec*1000+time.tv_nsec/1000000;
 char sql[512];snprintf(sql,sizeof(sql),"%s WHERE r.state='queued' ORDER BY r.enqueue_seq",nr_select_record);
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,sql,-1,&stmt,NULL)==SQLITE_OK,step=SQLITE_DONE;nr_record human={0},background={0};
 while(good&&(step=sqlite3_step(stmt))==SQLITE_ROW){nr_record record={0};good=nr_decode_record(stmt,&record);
  if(good){nr_eligible *e=nr_eligible_row(s,&record,now);if(e){nr_record *slot=e->priority?&human:&background;if(!slot->metadata){*slot=record;memset(&record,0,sizeof(record));}}}nr_record_clear(&record);
 }
 if(good)good=step==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 if(good){nr_record *selected=human.metadata&&(!background.metadata||burst<3)?&human:background.metadata?&background:NULL;
  if(selected){*priority=selected==&human;*out=*selected;memset(selected,0,sizeof(*selected));}
 }nr_record_clear(&human);nr_record_clear(&background);return good;
}
static int nr_receipt_cells(nr_cell *cells,const nr_record *r,const char *kind,const char *json){char hash[65];return nr_hash(json,hash)&&nr_text(cells,r->id)&&nr_text(cells+1,kind)&&nr_text(cells+2,hash)&&nr_text(cells+3,json);}
static napi_value claim_resource(napi_env env,napi_callback_info info){
 napi_value args[2],cap,out,record_out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 /* Native capability, parent retention and delivery objects exist before BEGIN. */
 nr_child *child=nr_new_child(env,args[0],s,NR_RESERVATION,&cap);out=object(env);record_out=object(env);napi_value none=nr_null(env);
 if(!child||!out||!record_out||!none)return nr_error(env,s,"ROOT_RESOURCE_CLAIM_UNCONFIRMED",0,0,0);
 nr_record old={0};nr_cell policy[NR_MAX_CELLS]={0},next_policy[NR_MAX_CELLS]={0},old_cells[NR_MAX_CELLS]={0},next_cells[NR_MAX_CELLS]={0},outbox[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};
 int began=nr_begin(s),committed=0,priority=0;sqlite3_int64 active=0;const char *error="ROOT_RESOURCE_CLAIM_UNCONFIRMED";
 if(!began||!floor_valid(s)||!nr_policy(s,policy)||!scalar(s->db,"SELECT count(*) FROM root_resources WHERE state IN ('reserved','running','cancel_pending','launch_unknown')",&active))goto bad;
 if(active>=policy[3].integer)goto empty;
 if(!nr_select_eligible(s,(int)policy[6].integer,&old,&priority))goto bad;if(!old.metadata)goto empty;
 if(policy[7].integer==NR_MAX_SAFE||old.revision==NR_MAX_SAFE||strcmp(old.state,"queued")||!nr_record_cells(&old,old_cells))goto bad;
 char claim[65],attempt[65];nr_nonce(claim);nr_nonce(attempt);
 if(!nr_clone(next_cells,old_cells,11))goto bad;nr_cell_clear(next_cells+8);nr_cell_clear(next_cells+9);nr_cell_clear(next_cells+10);
 next_cells[5].integer++;next_cells[6].integer=1;
 if(!nr_text(next_cells+8,"reserved")||!nr_text(next_cells+9,claim)||!nr_text(next_cells+10,attempt))goto bad;
 nr_integer(outbox+1,0);if(!nr_text(outbox,old.id)||!nr_text(outbox+2,"pending"))goto bad;
 char json[1600];int n=snprintf(json,sizeof(json),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimSeq\":%lld,\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",attempt,(long long)(policy[7].integer+1),claim,old.digest,old.id);
 if(n<0||(size_t)n>=sizeof(json)||!nr_receipt_cells(receipt,&old,"reserved",json)||!nr_clone(next_policy,policy,8))goto bad;
 next_policy[6].integer=priority?(policy[6].integer<3?policy[6].integer+1:3):0;next_policy[7].integer++;
 nr_write *r=nr_expect(s,NR_RESOURCES,NR_UPDATE,old_cells,next_cells),*o=r?nr_expect(s,NR_OUTBOX,NR_INSERT,NULL,outbox):NULL,*v=o?nr_expect(s,NR_RECEIPTS,NR_INSERT,NULL,receipt):NULL,*p=v?nr_expect(s,NR_POLICY,NR_UPDATE,policy,next_policy):NULL;
 if(!p||!nr_run_write(s,r)||!nr_run_write(s,o)||!nr_run_write(s,v)||!nr_run_write(s,p)||nr_read(s,old.key,&child->record)!=1)goto bad;
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);
 if(nr_fixture_commit_failed(s,1)){error="ROOT_RESOURCE_FIXTURE_COMMIT_WRAPPER_FAILURE";goto bad;}
 if(!nr_projection(env,record_out,&child->record)||!own_data(env,out,"record",record_out)||!own_data(env,out,"reservation",cap)||!nr_local_current(s))goto bad;
 child->valid=1;
 nr_record_clear(&old);nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);nr_cells_clear(old_cells,NR_MAX_CELLS);nr_cells_clear(next_cells,NR_MAX_CELLS);nr_cells_clear(outbox,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return out;
empty:
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);if(!nr_local_current(s))goto bad;
 nr_record_clear(&old);nr_cells_clear(policy,NR_MAX_CELLS);return none;
bad:
 nr_record_clear(&old);nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);nr_cells_clear(old_cells,NR_MAX_CELLS);nr_cells_clear(next_cells,NR_MAX_CELLS);nr_cells_clear(outbox,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return nr_abort(env,s,error,began,committed);
}
static int nr_binding(const nr_record *a,const nr_record *b){return !strcmp(a->id,b->id)&&!strcmp(a->key,b->key)&&!strcmp(a->digest,b->digest)&&!strcmp(a->claim,b->claim)&&!strcmp(a->attempt,b->attempt)&&a->generation==b->generation&&a->epoch==b->epoch;}
static int nr_exact_receipt(nr_session *s,const nr_record *r,const char *kind,const char *json){
 sqlite3_stmt *stmt=NULL;int result=-1;char digest[65];if(!nr_hash(json,digest))return -1;
 if(sqlite3_prepare_v2(s->db,"SELECT binding_hash,receipt_json FROM root_resource_receipts WHERE record_id=? AND kind=?",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_text(stmt,1,r->id,-1,SQLITE_TRANSIENT)==SQLITE_OK&&sqlite3_bind_text(stmt,2,kind,-1,SQLITE_STATIC)==SQLITE_OK){int step=sqlite3_step(stmt);
  if(step==SQLITE_DONE)result=0;
  else if(step==SQLITE_ROW&&sqlite3_column_type(stmt,0)==SQLITE_TEXT&&sqlite3_column_type(stmt,1)==SQLITE_TEXT){
   const unsigned char *hash=sqlite3_column_text(stmt,0),*actual=sqlite3_column_text(stmt,1);int hash_size=sqlite3_column_bytes(stmt,0),json_size=sqlite3_column_bytes(stmt,1);size_t expected_size=strlen(json);
   if(hash&&actual&&hash_size==64&&json_size>=0&&(size_t)json_size==expected_size&&!memcmp(hash,digest,64)&&!memcmp(actual,json,expected_size)&&sqlite3_step(stmt)==SQLITE_DONE)result=1;
  }
 }if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)result=-1;return result;
}
static napi_value consume_resource(napi_env env,napi_callback_info info){
 napi_value args[3],out,record_out,receipt_cap=NULL;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");nr_child *reservation=nr_get_child(env,args[1],s,NR_RESERVATION);if(!reservation)return fail(env,"ROOT_RESOURCE_RESERVATION_REQUIRED");
 nr_child *receipt_child=NULL;if(!reservation->receipt_ref){receipt_child=nr_new_child(env,args[0],s,NR_RECEIPT,&receipt_cap);if(!receipt_child)return nr_error(env,s,"ROOT_RESOURCE_CONSUME_UNCONFIRMED",0,0,0);}
 else if(napi_get_reference_value(env,reservation->receipt_ref,&receipt_cap)!=napi_ok||!receipt_cap)return nr_error(env,s,"ROOT_RESOURCE_CONSUME_UNCONFIRMED",0,0,0);
 out=object(env);record_out=object(env);if(!out||!record_out)return nr_error(env,s,"ROOT_RESOURCE_CONSUME_UNCONFIRMED",0,0,0);
 nr_record record={0};nr_cell old_box[NR_MAX_CELLS]={0},next_box[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};int began=nr_begin(s),committed=0,previous=-1;
 if(!began||!floor_valid(s)||nr_read(s,reservation->record.key,&record)!=1||!nr_binding(&reservation->record,&record))goto bad;
 char json[1600];int n=snprintf(json,sizeof(json),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",record.attempt,record.claim,record.digest,record.id);
 if(n<0||(size_t)n>=sizeof(json)||(previous=nr_exact_receipt(s,&record,"launch_consumed",json))<0)goto bad;
 if(previous){if(!reservation->receipt_ref||record.outbox!=1)goto bad;}
 else{
  if(strcmp(record.state,"reserved")||record.outbox!=0||reservation->receipt_ref)goto bad;
  nr_integer(old_box+1,0);nr_integer(next_box+1,1);
  if(!nr_text(old_box,record.id)||!nr_text(old_box+2,"pending")||!nr_text(next_box,record.id)||!nr_text(next_box+2,"consumed")||!nr_receipt_cells(receipt,&record,"launch_consumed",json))goto bad;
  nr_write *o=nr_expect(s,NR_OUTBOX,NR_UPDATE,old_box,next_box),*r=o?nr_expect(s,NR_RECEIPTS,NR_INSERT,NULL,receipt):NULL;
  if(!r||!nr_run_write(s,o)||!nr_run_write(s,r))goto bad;
  nr_record_clear(&record);if(nr_read(s,reservation->record.key,&record)!=1)goto bad;
 }
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);
 if(nr_fixture_commit_failed(s,2))goto wrapper_failed;
 if(!nr_projection(env,record_out,&record)||!own_data(env,out,"record",record_out)||!boolean(env,out,"newlyConsumed",!previous)||!own_data(env,out,"receipt",receipt_cap))goto bad;
 if(!previous){if(napi_create_reference(env,receipt_cap,1,&reservation->receipt_ref)!=napi_ok)goto bad;receipt_child->valid=1;}
 if(!nr_local_current(s))goto bad;
 nr_record_clear(&record);nr_cells_clear(old_box,NR_MAX_CELLS);nr_cells_clear(next_box,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return out;
bad:
 nr_record_clear(&record);nr_cells_clear(old_box,NR_MAX_CELLS);nr_cells_clear(next_box,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return nr_abort(env,s,"ROOT_RESOURCE_CONSUME_UNCONFIRMED",began,committed);
wrapper_failed:
 nr_record_clear(&record);nr_cells_clear(old_box,NR_MAX_CELLS);nr_cells_clear(next_box,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return nr_abort(env,s,"ROOT_RESOURCE_FIXTURE_COMMIT_WRAPPER_FAILURE",began,committed);
}
/* Negative settlement authenticates ownership without rechecking the
 * positive claim deadline. A cancelled row never becomes eligible again. */
static napi_value cancel_queued_resource(napi_env env,napi_callback_info info){
 napi_value args[3],out,record_out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],0);if(!s)return NULL;if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 nr_child *subject=nr_get_child(env,args[1],s,NR_SUBJECT);if(!subject)return fail(env,"ROOT_RESOURCE_SUBJECT_REQUIRED");
 out=object(env);record_out=object(env);if(!out||!record_out)return nr_error(env,s,"ROOT_RESOURCE_CANCEL_UNCONFIRMED",0,0,0);
 nr_record record={0};nr_cell old[NR_MAX_CELLS]={0},next[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};
 int began=nr_begin(s),committed=0,history=0,known=0;const char *error="ROOT_RESOURCE_CANCEL_UNCONFIRMED";
 if(!began||!floor_valid(s))goto bad;
 int found=nr_read(s,subject->record.key,&record);if(found<0)goto bad;
 if(!found){known=1;error="ROOT_RESOURCE_NOT_FOUND";goto bad;}
 if(strcmp(record.digest,subject->record.digest)){known=1;error="ROOT_RESOURCE_INPUT_CONFLICT";goto bad;}
 nr_eligible *owned=NULL;for(nr_eligible *e=s->eligible;e;e=e->next)if(!strcmp(e->record_id,record.id)&&!strcmp(e->digest,record.digest)&&e->seq==record.seq){owned=e;break;}
 if(!owned)goto bad;
 char json[1024];int size=snprintf(json,sizeof(json),"{\"acquireGeneration\":0,\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",record.digest,record.id);
 if(size<0||(size_t)size>=sizeof(json))goto bad;
 if(!strcmp(record.state,"cancelled_before_launch")){
  if(nr_exact_receipt(s,&record,"cancelled_before_launch",json)!=1)goto bad;history=1;
 }else if(strcmp(record.state,"queued")){known=1;error="ROOT_RESOURCE_ALREADY_CLAIMED";goto bad;}
 else{
  if(record.revision==NR_MAX_SAFE||!nr_record_cells(&record,old)||!nr_clone(next,old,11))goto bad;
  next[5].integer++;nr_cell_clear(next+8);if(!nr_text(next+8,"cancelled_before_launch")||!nr_receipt_cells(receipt,&record,"cancelled_before_launch",json))goto bad;
  nr_write *resource=nr_expect(s,NR_RESOURCES,NR_UPDATE,old,next),*fact=resource?nr_expect(s,NR_RECEIPTS,NR_INSERT,NULL,receipt):NULL;
  if(!fact||!nr_run_write(s,resource)||!nr_run_write(s,fact))goto bad;
  nr_record_clear(&record);if(nr_read(s,subject->record.key,&record)!=1)goto bad;
 }
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);
 if(nr_fixture_commit_failed(s,3)){error="ROOT_RESOURCE_FIXTURE_COMMIT_WRAPPER_FAILURE";goto bad;}
 if(!nr_projection(env,record_out,&record)||!own_data(env,out,"record",record_out)||!boolean(env,out,"cancelled",!history)||!text(env,out,"operation",history?"history":"cancelled_before_launch")||!nr_local_current(s))goto bad;
 nr_record_clear(&record);nr_cells_clear(old,NR_MAX_CELLS);nr_cells_clear(next,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return out;
 bad:
 nr_record_clear(&record);nr_cells_clear(old,NR_MAX_CELLS);nr_cells_clear(next,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);
 return known&&!committed?nr_known_rejection(env,s,error,began):nr_abort(env,s,error,began,committed);
}
static napi_value read_resource(napi_env env,napi_callback_info info){
 napi_value args[3];if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=session(env,args[0],0);if(!s)return NULL;char key[257];if(!nr_key(env,args[1],key))return fail(env,"ROOT_RESOURCE_KEY_REQUIRED");
 napi_value out=object(env);nr_record record={0};if(!out||!floor_valid(s))return nr_error(env,s,"ROOT_RESOURCE_RECORD_UNCONFIRMED",sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);
 int found=nr_read(s,key,&record);if(found<0||(found&&!nr_projection(env,out,&record))||!current(s)){nr_record_clear(&record);return nr_error(env,s,"ROOT_RESOURCE_RECORD_UNCONFIRMED",sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);}
 nr_record_clear(&record);return found?out:nr_null(env);
}
#include "root-finish.h"
#include "physical-resources.h"
#endif
