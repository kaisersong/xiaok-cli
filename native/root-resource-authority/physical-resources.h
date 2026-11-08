#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
#include "physical-history-data.h"
#include "physical-context.h"
static int nr_physical_project(napi_env env,napi_value out,const nr_cell *r){
 return text(env,out,"recordId",(const char*)r[0].bytes)&&text(env,out,"kind",r[1].integer==1?"model":"process")&&text(env,out,"executionClass",(const char*)r[2].bytes)&&text(env,out,"executionKey",(const char*)r[3].bytes)&&text(env,out,"metadataDigest",(const char*)r[5].bytes)&&number(env,out,"enqueueSeq",r[6].integer)&&text(env,out,"state",(const char*)r[7].bytes);
}
/* Capacity slots are SQL relationships, never SDK permits or guessed specs. */
static int nr_physical_id(nr_session *s,const char *id,nr_cell *row){
 sqlite3_stmt *stmt=NULL;char key[257];int result=-1;
 if(sqlite3_prepare_v2(s->db,"SELECT execution_key FROM root_physical_resources WHERE record_id=? AND resource_kind=2",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_text(stmt,1,id,-1,SQLITE_TRANSIENT)==SQLITE_OK){
  int step=sqlite3_step(stmt);if(step==SQLITE_DONE)result=0;
  else if(step==SQLITE_ROW&&nr_string_column(stmt,0,key,sizeof(key),0)&&sqlite3_step(stmt)==SQLITE_DONE)result=1;
 }
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)result=-1;
 return result==1?nr_physical_row(s,2,key,row):result;
}
static int nr_workflow_slot(nr_session *s,const char *root_id,nr_cell *slot){
 sqlite3_stmt *stmt=NULL;char id[257];int found=-1;
 if(sqlite3_prepare_v2(s->db,"SELECT record_id FROM root_physical_resources WHERE allocation_role='workflow_child_slot' AND native_root_id=?",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_text(stmt,1,root_id,-1,SQLITE_TRANSIENT)==SQLITE_OK){
  int step=sqlite3_step(stmt);if(step==SQLITE_DONE)found=0;
  else if(step==SQLITE_ROW&&nr_string_column(stmt,0,id,sizeof(id),0)&&sqlite3_step(stmt)==SQLITE_DONE)found=1;
 }
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)found=-1;
 return found==1?nr_physical_id(s,id,slot):found;
}
static int nr_has_eligible(nr_session *s,int kind,const nr_cell *row){
 for(nr_eligible *e=s->eligible;e;e=e->next)if(e->physical_kind==kind&&e->seq==row[6].integer&&!strcmp(e->record_id,(const char*)row[0].bytes)&&!strcmp(e->digest,(const char*)row[5].bytes))return 1;
 return 0;
}
static int nr_leaf_history(napi_env,nr_session*,const nr_cell*,napi_value);
#include "process-launch-intent.h"
static napi_value enqueue_physical(napi_env env,napi_callback_info info,int kind,int workflow_vm){
 napi_value args[4],parent=NULL,out=NULL,record_out=NULL;
 if(!arguments(env,info,3,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_child *context=nr_source_key(env,args[0],NR_CONTEXT);if(!context)return fail(env,"ROOT_RESOURCE_PHYSICAL_CONTEXT_REQUIRED");
 if(workflow_vm&&(kind!=2||context->source_kind!=NR_WORKFLOW_ROOT_KEY||!context->record.claim[0]))return fail(env,"ROOT_RESOURCE_WORKFLOW_CONTEXT_REQUIRED");
 if(napi_get_reference_value(env,context->parent_ref,&parent)!=napi_ok||!parent)return fail(env,"ROOT_RESOURCE_PHYSICAL_CONTEXT_REQUIRED");
 nr_session *s=main_session_member(env,info,parent);if(!s)return NULL;
 if(s->business_sealed)return fail(env,"ROOT_RESOURCE_BUSINESS_SEALED");
 if(!main_session_current(env,s))return NULL;
 char id[257],hash[257];if(!nr_key(env,args[1],id)||!nr_key(env,args[2],hash)||strlen(hash)!=64)return fail(env,"ROOT_RESOURCE_PHYSICAL_DATA_INVALID");
 for(int i=0;i<64;i++)if(!((hash[i]>='a'&&hash[i]<='f')||(hash[i]>='0'&&hash[i]<='9')))return fail(env,"ROOT_RESOURCE_PHYSICAL_DATA_INVALID");
 char *qid=nr_json_string(id),metadata[32768],execution_key[257],digest[65],identity[8192];
 if(!qid)return nr_error(env,s,"ROOT_RESOURCE_PHYSICAL_UNCONFIRMED",0,0,0);
 int n=snprintf(identity,sizeof(identity),"%d:%s:%s",kind,context->record.key,id);
 int good=n>0&&(size_t)n<sizeof(identity)&&nr_hash(identity,digest);
 snprintf(execution_key,sizeof(execution_key),"%s:%s",kind==1?"model":"process",digest);
 n=snprintf(metadata,sizeof(metadata),"{\"attemptId\":%s,\"bodyHash\":\"%s\",\"context\":%s,\"resourceKind\":\"%s\"}",qid,hash,context->record.metadata,kind==1?"model":"process");free(qid);
 if(!good||n<0||(size_t)n>=sizeof(metadata)||!nr_hash(metadata,digest))return nr_error(env,s,"ROOT_RESOURCE_PHYSICAL_UNCONFIRMED",0,0,0);
 nr_cell policy[NR_MAX_CELLS]={0},next_policy[NR_MAX_CELLS]={0},row[NR_MAX_CELLS]={0},slot[NR_MAX_CELLS]={0};
 nr_eligible *eligible=calloc(1,sizeof(*eligible));int began=0,committed=0,known=0;const char *error="ROOT_RESOURCE_PHYSICAL_UNCONFIRMED",*disposition="existing";
 if(!eligible)goto bad;began=nr_begin(s);if(!began)goto bad;
 int found=nr_physical_row(s,kind,execution_key,row);if(found<0||!nr_physical_policy(s,kind,policy))goto bad;
 if(found){if(row[5].length!=64||memcmp(row[5].bytes,digest,64)||(workflow_vm&&!nr_role(row,"workflow_vm"))||(!workflow_vm&&(nr_role(row,"workflow_vm")||nr_role(row,"workflow_child_slot")))){known=1;error="ROOT_RESOURCE_INPUT_CONFLICT";goto bad;}}
 else{
  sqlite3_stmt *count=NULL;sqlite3_int64 queued=-1;
  good=sqlite3_prepare_v2(s->db,"SELECT count(*) FROM root_physical_resources WHERE resource_kind=? AND state='queued'",-1,&count,NULL)==SQLITE_OK&&sqlite3_bind_int(count,1,kind)==SQLITE_OK&&sqlite3_step(count)==SQLITE_ROW;
  if(good)queued=sqlite3_column_int64(count,0);if(count&&sqlite3_finalize(count)!=SQLITE_OK)good=0;if(!good)goto bad;
  if(queued+(workflow_vm?2:1)>256){known=1;error="ROOT_RESOURCE_QUEUE_CAPACITY_REQUIRED";goto bad;}
  char record_id[65];nr_nonce(record_id);
  good=nr_text(row,record_id)&&nr_text(row+2,nr_execution_classes[context->source_kind-4])&&nr_text(row+3,execution_key)&&nr_text(row+4,metadata)&&nr_text(row+5,digest)&&nr_text(row+7,"queued");
  nr_integer(row+1,kind);nr_integer(row+6,policy[5].integer+1);nr_integer(row+9,0);nr_integer(row+10,1);
  if(context->record.claim[0])good=good&&nr_text(row+13,context->record.claim);
  int group=kind==2&&context->record.claim[0]?nr_workflow_slot(s,context->record.claim,slot):0;
  if(group<0)goto bad;
  if(workflow_vm){
   if(group){known=1;error="ROOT_RESOURCE_WORKFLOW_GROUP_EXISTS";goto bad;}
   good=good&&nr_text(row+11,"workflow_vm");
   char slot_id[65],slot_key[257],slot_json[1024],slot_hash[65];nr_nonce(slot_id);
   snprintf(slot_key,sizeof(slot_key),"process-slot:%s",record_id);
   snprintf(slot_json,sizeof(slot_json),"{\"intent\":\"workflow_child_capacity_v1\",\"nativeRootId\":\"%s\",\"vmRecordId\":\"%s\"}",context->record.claim,record_id);
   good=good&&nr_hash(slot_json,slot_hash)&&nr_text(slot,slot_id)&&nr_text(slot+2,"workflow_root")&&nr_text(slot+3,slot_key)&&nr_text(slot+4,slot_json)&&nr_text(slot+5,slot_hash)&&nr_text(slot+7,"queued")&&nr_text(slot+11,"workflow_child_slot")&&nr_text(slot+12,record_id)&&nr_text(slot+13,context->record.claim);
   nr_integer(slot+1,2);nr_integer(slot+6,policy[5].integer+2);nr_integer(slot+9,0);nr_integer(slot+10,1);
  }else if(group){
   if(!strcmp((const char*)slot[7].bytes,"released")){known=1;error="ROOT_RESOURCE_WORKFLOW_GROUP_CLOSED";goto bad;}
   good=good&&nr_text(row+11,"workflow_child_attempt")&&nr_text(row+12,(const char*)slot[0].bytes);
  }else good=good&&nr_text(row+11,"direct");
  if(!good||!nr_clone(next_policy,policy,8))goto bad;next_policy[5].integer+=workflow_vm?2:1;
  nr_write *r=nr_expect(s,NR_PH_RESOURCES,NR_INSERT,NULL,row),*p=r?nr_expect(s,NR_PH_POLICY,NR_UPDATE,policy,next_policy):NULL;
  nr_write *sl=workflow_vm&&p?nr_expect(s,NR_PH_RESOURCES,NR_INSERT,NULL,slot):NULL;
  if(!p||(workflow_vm&&!sl)||!nr_run_write(s,r)||(sl&&!nr_run_write(s,sl))||!nr_run_write(s,p))goto bad;
  memcpy(eligible->record_id,record_id,65);memcpy(eligible->digest,digest,65);eligible->seq=row[6].integer;eligible->physical_kind=kind;disposition="new_queued";
 }
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);
 out=object(env);record_out=object(env);
 if(!out||!record_out||!nr_physical_project(env,record_out,row)||!text(env,out,"disposition",disposition)||!own_data(env,out,"record",record_out)||!main_session_current(env,s))goto bad;
 if(!strcmp(disposition,"new_queued")){eligible->next=s->eligible;s->eligible=eligible;eligible=NULL;}
 nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(slot,NR_MAX_CELLS);free(eligible);return out;
bad:
 nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(slot,NR_MAX_CELLS);free(eligible);
 return known?nr_known_rejection(env,s,error,began):nr_abort(env,s,error,began,committed);
}
static napi_value claim_physical(napi_env env,napi_callback_info info,int kind){
 napi_value args[2],out=NULL,cap=NULL,record_out=NULL;
 if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 if(!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 nr_cell policy[NR_MAX_CELLS]={0},next_policy[NR_MAX_CELLS]={0};
 nr_cell row[NR_MAX_CELLS]={0},next[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};
 nr_cell slot[NR_MAX_CELLS]={0},next_slot[NR_MAX_CELLS]={0},slot_receipt[NR_MAX_CELLS]={0};
 nr_cell vm[NR_MAX_CELLS]={0},intent[NR_MAX_CELLS]={0};
 char launch_nonce[65]={0};
#ifdef NR_HAS_FIXTURE_FACTS
 size_t fixture_writes=0;
#endif
 int began=nr_begin(s),committed=0,good=began,selected=0,slot_change=0;
 sqlite3_stmt *stmt=NULL;sqlite3_int64 active=0;
 if(!good||!nr_physical_policy(s,kind,policy))goto bad;
 good=sqlite3_prepare_v2(s->db,"SELECT count(*) FROM root_physical_resources WHERE resource_kind=? AND state IN ('reserved','unknown') AND allocation_role IN ('direct','workflow_vm','workflow_child_slot')",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_int(stmt,1,kind)==SQLITE_OK&&sqlite3_step(stmt)==SQLITE_ROW;
 if(good)active=sqlite3_column_int64(stmt,0);
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;stmt=NULL;if(!good)goto bad;
 good=sqlite3_prepare_v2(s->db,"SELECT execution_key FROM root_physical_resources WHERE resource_kind=? AND state='queued' ORDER BY enqueue_seq",-1,&stmt,NULL)==SQLITE_OK&&sqlite3_bind_int(stmt,1,kind)==SQLITE_OK;
 int step=SQLITE_DONE;
 while(good&&(step=sqlite3_step(stmt))==SQLITE_ROW){
  char key[257];nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(slot,NR_MAX_CELLS);nr_cells_clear(vm,NR_MAX_CELLS);
  if(!nr_string_column(stmt,0,key,sizeof(key),0)||nr_physical_row(s,kind,key,row)!=1){good=0;break;}
  if(!nr_has_eligible(s,kind,row))continue;
  if(nr_role(row,"workflow_vm")){
   if(active+2>policy[3].integer)continue;
   if(nr_workflow_slot(s,(const char*)row[13].bytes,slot)!=1||!nr_state(slot,"queued")||strcmp((const char*)slot[12].bytes,(const char*)row[0].bytes)){good=0;break;}
   slot_change=1;selected=1;
  }else if(nr_role(row,"workflow_child_attempt")){
   if(nr_physical_id(s,(const char*)row[12].bytes,slot)!=1||!nr_role(slot,"workflow_child_slot")){good=0;break;}
   if(!nr_state(slot,"reserved")||slot[8].type!=SQLITE_NULL&&slot[8].type!=0)continue;
   if(nr_physical_id(s,(const char*)slot[12].bytes,vm)!=1||!nr_role(vm,"workflow_vm")||!nr_state(vm,"reserved")||strcmp((const char*)row[13].bytes,(const char*)slot[13].bytes)){good=0;break;}
   slot_change=2;selected=1;
  }else if(nr_role(row,"direct")&&active<policy[3].integer)selected=1;
  if(selected)break;
 }
 if(!selected&&step!=SQLITE_DONE)good=0;
 if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;stmt=NULL;if(!good)goto bad;
 if(!selected)goto empty;
 if(row[9].type!=SQLITE_INTEGER||row[9].integer<0||row[9].integer==NR_MAX_SAFE||policy[7].integer==NR_MAX_SAFE||!nr_clone(next,row,14)||!nr_clone(next_policy,policy,8))goto bad;
 char token[65];nr_nonce(token);nr_cell_clear(next+7);nr_cell_clear(next+8);
 if(!nr_text(next+7,"reserved")||!nr_text(next+8,token)||!nr_receipt(receipt,row,"reserved",token))goto bad;
 nr_integer(next+9,row[9].integer+1);next_policy[7].integer++;
 if(kind==2){nr_nonce(launch_nonce);if(!nr_process_intent(s,next,launch_nonce,intent))goto bad;}
 if(slot_change){
  if(!nr_clone(next_slot,slot,14))goto bad;
  nr_cell_clear(next_slot+7);nr_cell_clear(next_slot+8);
  if(!nr_text(next_slot+7,"reserved"))goto bad;
  if(slot_change==2&&!nr_text(next_slot+8,(const char*)row[0].bytes))goto bad;
  nr_integer(next_slot+9,slot[9].integer+1);
  if(slot_change==1&&!nr_receipt(slot_receipt,slot,"capacity_reserved",NULL))goto bad;
 }
 nr_write *r=nr_expect(s,NR_PH_RESOURCES,NR_UPDATE,row,next);
 nr_write *p=r?nr_expect(s,NR_PH_POLICY,NR_UPDATE,policy,next_policy):NULL;
 nr_write *rc=p?nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,receipt):NULL;
 nr_write *sl=slot_change&&rc?nr_expect(s,NR_PH_RESOURCES,NR_UPDATE,slot,next_slot):NULL;
 nr_write *sr=slot_change==1&&sl?nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,slot_receipt):NULL;
 nr_write *pi=kind==2&&rc?nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,intent):NULL;
 if(!rc||(kind==2&&!pi)||(slot_change&&!sl)||(slot_change==1&&!sr)||!nr_process_claim_write(s,r,kind==2)||!nr_process_claim_write(s,p,kind==2)||!nr_process_claim_write(s,rc,kind==2)||(sl&&!nr_process_claim_write(s,sl,kind==2))||(sr&&!nr_process_claim_write(s,sr,kind==2))||(pi&&!nr_process_claim_write(s,pi,1))||!nr_commit(s))goto bad;
 committed=1;
#ifdef NR_HAS_FIXTURE_FACTS
 fixture_writes=s->write_count;
#endif
 nr_clear_frame(s);
 if(nr_fixture_commit_failed(s,4))goto bad;
 nr_child *permit=nr_new_child(env,args[0],s,kind==1?NR_MODEL_PERMIT:NR_PROCESS_PERMIT,&cap);
 if(!permit)goto bad;
 snprintf(permit->record.id,sizeof(permit->record.id),"%s",(const char*)next[0].bytes);
 snprintf(permit->record.key,sizeof(permit->record.key),"%s",(const char*)next[3].bytes);
 snprintf(permit->record.digest,sizeof(permit->record.digest),"%s",(const char*)next[5].bytes);
 snprintf(permit->record.claim,sizeof(permit->record.claim),"%s",token);
 permit->record.seq=next[6].integer;permit->physical_kind=kind;
 permit->record.generation=next[9].integer;permit->record.epoch=next[10].integer;
 if(kind==2)snprintf(permit->record.attempt,sizeof(permit->record.attempt),"%s",launch_nonce);
 out=object(env);record_out=object(env);
 if(!out||!record_out||!nr_physical_project(env,record_out,next)||!own_data(env,out,"permit",cap)||!own_data(env,out,"record",record_out)||!nr_local_current(s))goto bad;
#ifdef NR_HAS_FIXTURE_FACTS
 if(!number(env,out,"fixtureClaimWriteCount",(sqlite3_int64)fixture_writes))goto bad;
#endif
 permit->valid=1;goto done;
empty:
 if(!nr_commit(s))goto bad;nr_clear_frame(s);out=nr_null(env);goto done;
bad:
 if(stmt)sqlite3_finalize(stmt);
 out=nr_abort(env,s,"ROOT_RESOURCE_PHYSICAL_CLAIM_UNCONFIRMED",began,committed);
done:
 nr_cells_clear(policy,NR_MAX_CELLS);nr_cells_clear(next_policy,NR_MAX_CELLS);
 nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(next,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);
 nr_cells_clear(slot,NR_MAX_CELLS);nr_cells_clear(next_slot,NR_MAX_CELLS);nr_cells_clear(slot_receipt,NR_MAX_CELLS);nr_cells_clear(vm,NR_MAX_CELLS);nr_cells_clear(intent,NR_MAX_CELLS);
 return out;
}
static napi_value settle_physical(napi_env env,napi_callback_info info,int kind){
 napi_value args[3],out=NULL;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_session *s=session(env,args[0],0);if(!s)return NULL;
 nr_child *permit=nr_get_child(env,args[1],s,kind==1?NR_MODEL_PERMIT:NR_PROCESS_PERMIT);
 if(!permit)return fail(env,"ROOT_RESOURCE_PHYSICAL_PERMIT_REQUIRED");
 if(permit->leaf&&!nr_leaf_can_settle(permit->leaf))return fail(env,"ROOT_RESOURCE_READONLY_LEAF_PENDING");
 nr_cell row[NR_MAX_CELLS]={0},next[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};
 nr_cell slot[NR_MAX_CELLS]={0},next_slot[NR_MAX_CELLS]={0},slot_receipt[NR_MAX_CELLS]={0};
 int began=nr_begin(s),committed=0,newly=0,slot_change=0,known=0;
 if(!began||nr_physical_row(s,kind,permit->record.key,row)!=1||row[0].length!=(int)strlen(permit->record.id)||memcmp(row[0].bytes,permit->record.id,(size_t)row[0].length)||row[5].length!=64||memcmp(row[5].bytes,permit->record.digest,64)||row[8].type!=SQLITE_TEXT||row[8].length!=(int)strlen(permit->record.claim)||memcmp(row[8].bytes,permit->record.claim,(size_t)row[8].length))goto bad;
 if(!nr_state(row,"released")){
  if(!nr_state(row,"reserved")&&!nr_state(row,"unknown"))goto bad;
  if(nr_role(row,"workflow_vm")){
   if(nr_workflow_slot(s,(const char*)row[13].bytes,slot)!=1||!nr_state(slot,"reserved"))goto bad;
   sqlite3_stmt *pending=NULL;sqlite3_int64 count=0;
   int good=sqlite3_prepare_v2(s->db,"SELECT count(*) FROM root_physical_resources WHERE parent_record_id=? AND state<>'released'",-1,&pending,NULL)==SQLITE_OK&&sqlite3_bind_text(pending,1,(const char*)slot[0].bytes,-1,SQLITE_TRANSIENT)==SQLITE_OK&&sqlite3_step(pending)==SQLITE_ROW;
   if(good)count=sqlite3_column_int64(pending,0);
   if(pending&&sqlite3_finalize(pending)!=SQLITE_OK)good=0;if(!good)goto bad;
   if(slot[8].type==SQLITE_TEXT||count){known=1;goto bad;}
   slot_change=1;
  }else if(nr_role(row,"workflow_child_attempt")){
   if(nr_physical_id(s,(const char*)row[12].bytes,slot)!=1||!nr_state(slot,"reserved")||slot[8].type!=SQLITE_TEXT||strcmp((const char*)slot[8].bytes,(const char*)row[0].bytes))goto bad;
   slot_change=2;
  }
  if(!nr_clone(next,row,14))goto bad;nr_cell_clear(next+7);
  if(!nr_text(next+7,"released")||!nr_receipt(receipt,row,"released",permit->record.claim))goto bad;
  if(slot_change){
   if(!nr_clone(next_slot,slot,14))goto bad;nr_cell_clear(next_slot+8);
   if(slot_change==1){nr_cell_clear(next_slot+7);if(!nr_text(next_slot+7,"released")||!nr_receipt(slot_receipt,slot,"released",NULL))goto bad;}
  }
  nr_write *r=nr_expect(s,NR_PH_RESOURCES,NR_UPDATE,row,next);
  nr_write *rc=r?nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,receipt):NULL;
  nr_write *sl=slot_change&&rc?nr_expect(s,NR_PH_RESOURCES,NR_UPDATE,slot,next_slot):NULL;
  nr_write *sr=slot_change==1&&sl?nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,slot_receipt):NULL;
  if(!rc||(slot_change&&!sl)||(slot_change==1&&!sr)||!nr_run_write(s,r)||!nr_run_write(s,rc)||(sl&&!nr_run_write(s,sl))||(sr&&!nr_run_write(s,sr)))goto bad;
  newly=1;
 }
 if(!nr_commit(s))goto bad;committed=1;nr_clear_frame(s);
 if(nr_fixture_commit_failed(s,5))goto bad;
 out=object(env);
 if(!out||!boolean(env,out,"newlySettled",newly)||!current(s))goto bad;
 goto done;
bad:
 out=known?nr_known_rejection(env,s,"ROOT_RESOURCE_WORKFLOW_CHILD_ACTIVE",began):nr_abort(env,s,"ROOT_RESOURCE_PHYSICAL_SETTLEMENT_UNCONFIRMED",began,committed);
done:
 nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(next,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);
 nr_cells_clear(slot,NR_MAX_CELLS);nr_cells_clear(next_slot,NR_MAX_CELLS);nr_cells_clear(slot_receipt,NR_MAX_CELLS);return out;
}
#include "readonly-leaf.h"
#define NR_PHYSICAL_METHODS(name,kind) \
 static napi_value enqueue_original_##name(napi_env e,napi_callback_info i){return enqueue_physical(e,i,kind,0);} \
 static napi_value claim_original_##name(napi_env e,napi_callback_info i){return claim_physical(e,i,kind);} \
 static napi_value settle_original_##name(napi_env e,napi_callback_info i){return settle_physical(e,i,kind);}
static napi_value enqueue_original_workflow_vm_process(napi_env e,napi_callback_info i){return enqueue_physical(e,i,2,1);}
NR_PHYSICAL_METHODS(model,1)
NR_PHYSICAL_METHODS(process,2)
#undef NR_PHYSICAL_METHODS
#endif
