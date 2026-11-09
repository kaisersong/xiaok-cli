#ifndef XIAOK_MAIN_INSTALLATION_ROOT_STORE_RECEIPTS_H
#define XIAOK_MAIN_INSTALLATION_ROOT_STORE_RECEIPTS_H
/* Complete records only. No prefix repair or truncation on a damaged tail. */
static int store_apply(state *s,mi_store_lease *l,const unsigned char b[512]){(void)s;
 mi_store_state *q=&l->store;unsigned char digest[32];st_hash(b,480,digest);uint32_t type=st_u32(b+12),phase=st_u32(b+248);uint64_t seq=st_u64(b+16),gen=st_u64(b+252);
 if(memcmp(b,"XMRCP002",8)||st_u32(b+8)!=2||type<1||type>7||seq!=q->sequence+1||seq>STORE_MAX_RECORDS||memcmp(b+24,q->head,32)||memcmp(digest,b+480,32)||memcmp(b+56,q->namespace_id,32)||memcmp(b+88,q->birth_id,32)||memcmp(b+184,q->anchor_digest,32)||memcmp(b+216,q->profile,32)||st_nonzero(b+420,60)||st_u32(b+336)||st_u32(b+332)!=s->birth.uid||!st_nonzero(b+388,32))return 0;
 if(type==1){if(q->sequence||phase!=1||st_nonzero(b+120,64)||gen||st_nonzero(b+260,64))return 0;}
 else if(type==2){if(q->phase!=1||phase!=2||gen||!st_nonzero(b+120,32)||!st_nonzero(b+152,32)||st_nonzero(b+260,64))return 0;memcpy(q->pool_id,b+120,32);memcpy(q->claim_id,b+152,32);memcpy(q->claim_nonce,b+356,32);q->claim_pid=st_u32(b+328);}
 else{
  if(q->phase<2||memcmp(b+120,q->pool_id,32)||memcmp(b+152,q->claim_id,32))return 0;
  if(type==3){if(q->phase!=2||phase!=3||gen!=q->generation)return 0;}
  else{
   if(phase!=(uint32_t)q->phase||!gen||!st_nonzero(b+260,32))return 0;
   struct stat fact;if(!st_decode_fact(b+292,&fact,l->file_identity[MI_DATABASE].st_uid))return 0;
   if(type==4){if(q->journal_state||q->generation==UINT64_MAX||gen!=q->generation+1)return 0;q->journal_state=1;q->generation=gen;l->file_identity[MI_JOURNAL]=fact;}
   else{if(!q->journal_state||gen!=q->generation||!identity(&fact,&l->file_identity[MI_JOURNAL]))return 0;if(type==5){if(q->journal_state!=1)return 0;}else if(type==6){if(q->journal_state!=1)return 0;q->journal_state=2;memcpy(q->operation,b+388,32);}else{if(q->journal_state!=2||memcmp(q->operation,b+388,32))return 0;q->journal_state=0;}}
   memcpy(q->audit_ticket,b+260,32);
  }
 }
 q->phase=(int)phase;q->sequence=seq;memcpy(q->head,digest,32);return 1;
}
static int store_append(state *s,mi_store_lease *l,uint32_t type,uint32_t phase){(void)s;
 mi_store_state *q=&l->store;if(q->receipt_fd<0||q->sequence>=STORE_MAX_RECORDS)return 0;l->io_entered=1;
 unsigned char b[512]={0};memcpy(b,"XMRCP002",8);st_p32(b+8,2);st_p32(b+12,type);st_p64(b+16,q->sequence+1);memcpy(b+24,q->head,32);memcpy(b+56,q->namespace_id,32);memcpy(b+88,q->birth_id,32);memcpy(b+120,q->pool_id,32);memcpy(b+152,q->claim_id,32);memcpy(b+184,q->anchor_digest,32);memcpy(b+216,q->profile,32);st_p32(b+248,phase);st_p64(b+252,type==4?q->generation+1:q->generation);
 if(q->journal_state||type>=4){memcpy(b+260,st_nonzero(q->ticket,32)?q->ticket:q->audit_ticket,32);st_fact(b+292,&l->file_identity[MI_JOURNAL]);}
 st_p32(b+324,(uint32_t)getpid());st_p32(b+328,(uint32_t)s->child);st_p32(b+332,s->birth.uid);
 st_p64(b+340,(uint64_t)s->child_identity.pbi_start_tvsec);st_p64(b+348,(uint64_t)s->child_identity.pbi_start_tvusec);memcpy(b+356,s->birth.nonce,32);
 if(type==6||type==7)memcpy(b+388,q->operation,32);else if(!st_nonce(b+388))return 0;
 st_hash(b,480,b+480);off_t at=(off_t)(q->sequence*512);size_t wrote=0;
 while(wrote<512){ssize_t n=pwrite(q->receipt_fd,b+wrote,512-wrote,at+(off_t)wrote);if(n>0)wrote+=(size_t)n;else if(n<0&&errno==EINTR)continue;else{store_mark_unknown(s,l);return 0;}}
 if(fsync(q->receipt_fd)){store_mark_unknown(s,l);return 0;}
 /* Live state updates occur only after the original append has been synced. */
 if(!store_apply(s,l,b)){store_mark_unknown(s,l);return 0;}
 return !fstat(q->receipt_fd,&q->receipt_identity);
}
#endif
