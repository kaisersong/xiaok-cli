#ifndef XIAOK_ROOT_POOL_LEDGER_TRANSFER_H
#define XIAOK_ROOT_POOL_LEDGER_TRANSFER_H
#include "../main-installation/enrollment-custody-channel.h"
/* Only the original holder may consume its actual Native inherited channel.
 * This is custody of three original descriptors, never an adoption grant. */
static napi_value nr_ledger_hold_prepare_transfer(napi_env env,napi_callback_info info){
 nr_ledger_hold *h=nr_ledger_hold_member(env,info);if(!h)return NULL;
 if(!nr_ledger_hold_current(h))return nr_ledger_hold_error(env,h);
#ifdef NR_FIXTURE_BUILD
 const uint32_t kind=2;
#else
 const uint32_t kind=1;
#endif
 struct proc_bsdinfo parent;
 if(!mi_cu_parent(kind,&parent)||!mi_cu_socket(MI_CUSTODY_SOURCE_FD,parent.pbi_uid))return fail(env,"ROOT_LEDGER_TRANSFER_BIRTH_REQUIRED");
 h->transfer_started=1;h->transfer_fd=MI_CUSTODY_SOURCE_FD;
 mi_custody_birth birth;
 if(!mi_cu_read_birth(h->transfer_fd,1,kind,&birth))goto unconfirmed;
 unsigned char pool[32],digest[32];char pool_text[65];sqlite3_stmt *q=NULL;nr_session *s=&h->source->view;
 int good=sqlite3_prepare_v2(s->db,"SELECT pool_id FROM root_pool_identity WHERE singleton=1",-1,&q,NULL)==SQLITE_OK&&sqlite3_step(q)==SQLITE_ROW&&nr_string_column(q,0,pool_text,sizeof(pool_text),0)&&nr_intent_nonce(pool_text)&&sqlite3_step(q)==SQLITE_DONE;
 if(q&&sqlite3_finalize(q)!=SQLITE_OK)good=0;
 if(!good)goto unconfirmed;
 for(int i=0;i<32;i++){unsigned char a=(unsigned char)pool_text[2*i],b=(unsigned char)pool_text[2*i+1];pool[i]=(unsigned char)(((a<='9'?a-'0':a-'a'+10)<<4)|(b<='9'?b-'0':b-'a'+10));}
 nr_ledger_digest(&h->initial,digest);
 if(!nr_ledger_existing_current(s)||!nr_ledger_source_close_readers(h->source)||!nr_ledger_existing_current(s))goto unconfirmed;
 int original_fds[]={s->directory,s->lock_fd,h->source->probe};
 if(!mi_cu_send_fds(h->transfer_fd,&birth,original_fds,digest,pool)||!nr_ledger_existing_current(s))goto unconfirmed;
 unsigned char ack[40];
 if(!mi_cu_read(h->transfer_fd,ack,sizeof(ack))||memcmp(ack,"XMFDACK1",8)||memcmp(ack+8,birth.nonce,32))goto unconfirmed;
 napi_value out;napi_get_undefined(env,&out);return out;
unconfirmed:
 h->unknown=1;h->source->unknown=h->source->view.unknown=1;if(!h->first)h->first="ROOT_LEDGER_TRANSFER_UNCONFIRMED";return nr_ledger_hold_error(env,h);
}
#endif
