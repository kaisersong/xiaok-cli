static void nr_leaf_ready_execute(napi_env env,void *data){
 (void)env;struct nr_leaf *l=data;char buffer[256];size_t used=0;int good=1;
 if(!l->spawned)return;
 while(used<sizeof(buffer)-1){
  if(nr_leaf_expired(l)){good=0;l->timed_out=1;break;}
  struct pollfd ready={l->ready,POLLIN|POLLHUP,0};int polled=poll(&ready,1,10);
  if(polled<0&&errno==EINTR)continue;
  if(polled<0){good=0;l->unknown=1;break;}if(!polled)continue;
  ssize_t n=read(l->ready,buffer+used,sizeof(buffer)-1-used);if(n<0&&errno==EINTR)continue;if(n<=0){good=0;break;}used+=(size_t)n;if(memchr(buffer,'\n',used))break;
 }
 buffer[used]=0;char expected[160];snprintf(expected,sizeof(expected),"READY %s %s\n",l->nonce,l->spec_hash);
 pthread_mutex_lock(&l->mutex);nr_leaf_wait_locked(l);errno=0;int denied=l->spawned&&!l->reaped?sandbox_check(l->pid,"process-fork",0):-1;
 int kernel_good=denied==1&&errno==0&&nr_leaf_sample(l);if(kernel_good)l->sandbox_observed=1;
 good=good&&!strcmp(buffer,expected)&&!l->fenced&&!l->reaped&&kernel_good;
 if(!nr_leaf_close(&l->ready))l->unknown=1;l->ready_ok=good&&!l->unknown;pthread_mutex_unlock(&l->mutex);
}
static napi_value nr_leaf_error(napi_env env,const char *message){napi_value text_value,error;napi_create_string_utf8(env,message,NAPI_AUTO_LENGTH,&text_value);napi_create_error(env,NULL,text_value,&error);return error;}
static void nr_leaf_ready_complete(napi_env env,napi_status status,void *data){
 struct nr_leaf *l=data;l->ready_busy=0;
 if(status==napi_ok&&l->ready_ok){napi_value token,parent;nr_child *c=NULL;if(napi_get_reference_value(env,l->permit->parent_ref,&parent)==napi_ok)c=nr_new_child(env,parent,l->session,NR_LEAF_READY,&token);
  if(c){c->leaf=l;snprintf(c->record.id,sizeof(c->record.id),"%s",l->permit->record.id);snprintf(c->record.attempt,sizeof(c->record.attempt),"%s",l->nonce);c->valid=1;napi_resolve_deferred(env,l->ready_deferred,token);}else napi_reject_deferred(env,l->ready_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED"));
 }else napi_reject_deferred(env,l->ready_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED"));
 napi_delete_async_work(env,l->ready_work);l->ready_work=NULL;
}
static napi_value wait_original_readonly_leaf_ready(napi_env env,napi_callback_info info){
 napi_value args[3],promise,label;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 struct nr_leaf *l=p->leaf;if(!l)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_REQUIRED");
 if(l->ready_promise){napi_get_reference_value(env,l->ready_promise,&promise);return promise;}
 if(napi_create_promise(env,&l->ready_deferred,&promise)!=napi_ok||napi_create_reference(env,promise,1,&l->ready_promise)!=napi_ok||napi_create_string_utf8(env,"original-readonly-ready",NAPI_AUTO_LENGTH,&label)!=napi_ok)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED");
 l->ready_busy=1;if(napi_create_async_work(env,NULL,label,nr_leaf_ready_execute,nr_leaf_ready_complete,l,&l->ready_work)!=napi_ok||napi_queue_async_work(env,l->ready_work)!=napi_ok){
  l->ready_busy=0;l->unknown=1;
  pthread_mutex_lock(&l->mutex);nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);
  if(l->ready_work){napi_delete_async_work(env,l->ready_work);l->ready_work=NULL;}
  napi_reject_deferred(env,l->ready_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_READY_UNCONFIRMED"));
 }return promise;
}
static napi_value bind_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[4],out;if(!arguments(env,info,3,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 nr_child *token=nr_get_child(env,args[2],s,NR_LEAF_READY);struct nr_leaf *l=p->leaf;
 if(!l||!token||token->leaf!=l||strcmp(token->record.id,p->record.id)||strcmp(token->record.attempt,l->nonce))return fail(env,"ROOT_RESOURCE_READONLY_LEAF_READY_REQUIRED");
 if(!main_session_current(env,s)||!s->fresh_owner)return fail(env,"ROOT_RESOURCE_ISSUER_RECONCILIATION_REQUIRED");
 pthread_mutex_lock(&l->mutex);int good=l->ready_ok&&!l->fenced&&!l->unknown&&!l->go_entered;nr_leaf_wait_locked(l);good=good&&!l->reaped&&nr_leaf_sample(l);pthread_mutex_unlock(&l->mutex);
 if(!good)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_BINDING_UNCONFIRMED");
 char json[2048],hash[65];snprintf(json,sizeof(json),"{\"schemaVersion\":1,\"kind\":\"original_readonly_leaf_binding_v1\",\"recordId\":\"%s\",\"launchNonce\":\"%s\",\"claimToken\":\"%s\",\"specHash\":\"%s\",\"issuerEpoch\":%lld,\"acquireGeneration\":%lld,\"bootId\":\"%s\",\"pid\":%d,\"uid\":%u,\"startSeconds\":%llu,\"startMicros\":%llu,\"profile\":\"darwin_nofork_bounded_glob_js_v1\",\"assetHash\":\"%s\",\"policyHash\":\"%s\"}",p->record.id,l->nonce,p->record.claim,l->spec_hash,(long long)p->record.epoch,(long long)p->record.generation,l->boot,l->pid,l->birth.pbi_uid,l->birth.pbi_start_tvsec,l->birth.pbi_start_tvusec,l->asset_hash,l->policy_hash);
 nr_cell row[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};int began=nr_begin(s),committed=0;
 good=began&&nr_leaf_row(s,p,row)&&nr_hash(json,hash)&&nr_text(receipt,p->record.id)&&nr_text(receipt+1,"process_binding_v1")&&nr_text(receipt+2,hash)&&nr_text(receipt+3,json);
 sqlite3_stmt *q=NULL;int found=0;if(good){good=sqlite3_prepare_v2(s->db,"SELECT binding_hash,receipt_json FROM root_physical_receipts WHERE record_id=? AND kind='process_binding_v1'",-1,&q,NULL)==SQLITE_OK&&sqlite3_bind_text(q,1,p->record.id,-1,SQLITE_STATIC)==SQLITE_OK;int step=good?sqlite3_step(q):SQLITE_ERROR;if(step==SQLITE_ROW){found=1;good=nr_column_equal(receipt+2,q,0)&&nr_column_equal(receipt+3,q,1)&&sqlite3_step(q)==SQLITE_DONE;}else good=step==SQLITE_DONE;}
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 if(good&&!found){nr_write *w=nr_expect(s,NR_PH_RECEIPTS,NR_INSERT,NULL,receipt);good=w&&nr_run_write(s,w);}
 if(good)good=nr_commit(s);if(good){committed=1;nr_clear_frame(s);snprintf(l->binding_hash,sizeof(l->binding_hash),"%s",hash);l->bound=1;}
 nr_cells_clear(row,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);if(!good)return nr_abort(env,s,"ROOT_RESOURCE_READONLY_LEAF_BINDING_UNCONFIRMED",began,committed);
 napi_get_undefined(env,&out);return out;
}
static napi_value go_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;struct nr_leaf *l=p->leaf;
 if(!l||!main_session_current(env,s)||!s->fresh_owner)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_REQUIRED");
 pthread_mutex_lock(&l->mutex);nr_leaf_wait_locked(l);int good=l->bound&&l->ready_ok&&!l->fenced&&!l->unknown&&!l->go_entered&&!l->reaped&&current(s);if(good)l->go_entered=1;pthread_mutex_unlock(&l->mutex);if(!good)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_GO_REFUSED");
 size_t size=strlen(l->canonical)+160;char *frame=malloc(size);if(!frame){l->unknown=1;return fail(env,"ROOT_RESOURCE_READONLY_LEAF_GO_UNCONFIRMED");}
 int n=snprintf(frame,size,"GO %s %s\n%s",l->nonce,l->spec_hash,l->canonical);size_t offset=0;
 while(n>0&&offset<(size_t)n){ssize_t count=write(l->input,frame+offset,(size_t)n-offset);if(count<0&&errno==EINTR)continue;if(count<=0){good=0;break;}offset+=(size_t)count;}

 free(frame);if(!nr_leaf_close(&l->input))good=0;if(!good){l->unknown=1;return fail(env,"ROOT_RESOURCE_READONLY_LEAF_GO_UNCONFIRMED");}napi_get_undefined(env,&out);return out;
}
static napi_value cancel_original_readonly_leaf(napi_env env,napi_callback_info info){
 napi_value args[3],out;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;
 if(p->leaf){
  struct nr_leaf *l=p->leaf;pthread_mutex_lock(&l->mutex);
  // A completed operation stays immutable when cleanup is repeated.
  int already_closed=l->closed;if(!already_closed)nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);
  if(!already_closed&&!nr_leaf_write_fence(l))return nr_error(env,s,"ROOT_RESOURCE_READONLY_LEAF_FENCE_UNCONFIRMED",sqlite3_errcode(s->db),sqlite3_extended_errcode(s->db),0);
 }napi_get_undefined(env,&out);return out;
}
static int nr_leaf_read_output(struct nr_leaf *l,int *fd,char **buffer,size_t *used){
 if(*fd<0)return 1;char bytes[8192];ssize_t count=read(*fd,bytes,sizeof(bytes));
 if(count<0&&(errno==EINTR||errno==EAGAIN))return 1;
 if(count<=0){if(count<0)l->unknown=1;if(!nr_leaf_close(fd))l->unknown=1;return 1;}
 if(*used+(size_t)count>NR_LEAF_MAX_BYTES){l->unknown=1;return 0;}
 char *next=realloc(*buffer,*used+(size_t)count+1);if(!next){l->unknown=1;return 0;}*buffer=next;memcpy(next+*used,bytes,(size_t)count);*used+=(size_t)count;next[*used]=0;return 1;
}
static void nr_leaf_closed_execute(napi_env env,void *data){
 (void)env;struct nr_leaf *l=data;
 if(l->output>=0&&fcntl(l->output,F_SETFL,O_NONBLOCK))l->unknown=1;
 if(l->errors>=0&&fcntl(l->errors,F_SETFL,O_NONBLOCK))l->unknown=1;
 for(;;){
  pthread_mutex_lock(&l->mutex);nr_leaf_wait_locked(l);
 int output_good=nr_leaf_read_output(l,&l->output,&l->stdout_data,&l->stdout_size);
  int errors_good=nr_leaf_read_output(l,&l->errors,&l->stderr_data,&l->stderr_size);
  if(nr_leaf_expired(l)){l->timed_out=1;nr_leaf_cancel_locked(l);}
  if(!output_good||!errors_good)nr_leaf_cancel_locked(l);
  int done=(!l->spawned||l->reaped)&&l->output<0&&l->errors<0;pthread_mutex_unlock(&l->mutex);if(done)break;
  struct pollfd fds[2]={{l->output,POLLIN|POLLHUP,0},{l->errors,POLLIN|POLLHUP,0}};
  if(poll(fds,2,10)<0&&errno!=EINTR){pthread_mutex_lock(&l->mutex);l->unknown=1;nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);}
 }
 pthread_mutex_lock(&l->mutex);
 if(!nr_leaf_close(&l->input))l->unknown=1;
 if(!nr_leaf_close(&l->ready))l->unknown=1;
 /* A payload requires the actually observed no-fork kernel gate. No GO may
  * settle only the exact owned child after cancellation, never a PID census. */
 if(l->go_entered&&(!l->ready_ok||!l->bound))l->unknown=1;
 if(l->spawned&&!l->sandbox_observed)l->unknown=1;
 l->closed=1;pthread_mutex_unlock(&l->mutex);
}
static void nr_leaf_closed_complete(napi_env env,napi_status status,void *data){
 struct nr_leaf *l=data;l->closed_busy=0;if(l->session->leaf_pending>0)l->session->leaf_pending--;
 napi_value out=object(env);int good=status==napi_ok&&!l->unknown&&nr_leaf_write_closed(l)&&out&&text(env,out,"stdout",l->stdout_data?l->stdout_data:"")&&text(env,out,"stderr",l->stderr_data?l->stderr_data:"")&&number(env,out,"exitCode",l->spawned&&WIFEXITED(l->status)?WEXITSTATUS(l->status):-1)&&number(env,out,"signal",l->spawned&&WIFSIGNALED(l->status)?WTERMSIG(l->status):0)&&boolean(env,out,"timedOut",l->timed_out);
 if(good)napi_resolve_deferred(env,l->closed_deferred,out);else napi_reject_deferred(env,l->closed_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_CLOSED_UNCONFIRMED"));
 napi_delete_async_work(env,l->closed_work);l->closed_work=NULL;
 napi_ref held=l->permit_ref;l->permit_ref=NULL;
 if(held)napi_delete_reference(env,held);
}
static napi_value wait_original_readonly_leaf_closed(napi_env env,napi_callback_info info){
 napi_value args[3],promise,label;if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=NULL;nr_child *p=nr_leaf_permit(env,args[0],args[1],&s);if(!p)return NULL;struct nr_leaf *l=p->leaf;
 if(!l)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_REQUIRED");if(l->closed_promise){napi_get_reference_value(env,l->closed_promise,&promise);return promise;}
 if(l->ready_busy)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_READY_PENDING");
 if(napi_create_promise(env,&l->closed_deferred,&promise)!=napi_ok||napi_create_reference(env,promise,1,&l->closed_promise)!=napi_ok||napi_create_string_utf8(env,"original-readonly-closed",NAPI_AUTO_LENGTH,&label)!=napi_ok)return fail(env,"ROOT_RESOURCE_READONLY_LEAF_CLOSED_UNCONFIRMED");
 l->closed_busy=1;if(napi_create_async_work(env,NULL,label,nr_leaf_closed_execute,nr_leaf_closed_complete,l,&l->closed_work)!=napi_ok||napi_queue_async_work(env,l->closed_work)!=napi_ok){
  l->closed_busy=0;l->unknown=1;
  pthread_mutex_lock(&l->mutex);nr_leaf_cancel_locked(l);pthread_mutex_unlock(&l->mutex);
  if(l->closed_work){napi_delete_async_work(env,l->closed_work);l->closed_work=NULL;}
  napi_reject_deferred(env,l->closed_deferred,nr_leaf_error(env,"ROOT_RESOURCE_READONLY_LEAF_CLOSED_UNCONFIRMED"));
 }return promise;
}

#include "readonly-leaf-history.h"
