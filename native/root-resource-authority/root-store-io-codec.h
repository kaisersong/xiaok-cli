#ifndef XIAOK_ORIGINAL_ROOT_STORE_IO_CODEC_H
#define XIAOK_ORIGINAL_ROOT_STORE_IO_CODEC_H
#include "root-store-io.h"
#include <limits.h>
#include <string.h>
#include <sys/stat.h>

static uint32_t nr_io_u32(const unsigned char *p){return (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
static uint64_t nr_io_u64(const unsigned char *p){uint64_t v=0;for(int i=0;i<8;i++)v=(v<<8)|p[i];return v;}
static void nr_io_put32(unsigned char *p,uint32_t v){for(int i=3;i>=0;i--){p[i]=(unsigned char)v;v>>=8;}}
static void nr_io_put64(unsigned char *p,uint64_t v){for(int i=7;i>=0;i--){p[i]=(unsigned char)v;v>>=8;}}
static int nr_io_nonzero(const unsigned char p[32]){unsigned value=0;for(int i=0;i<32;i++)value|=p[i];return value!=0;}
static int nr_io_fact(const unsigned char *p,nr_root_file_fact *out){
 out->device=nr_io_u64(p);out->inode=nr_io_u64(p+8);out->uid=nr_io_u32(p+16);out->mode=nr_io_u32(p+20);out->nlink=nr_io_u64(p+24);
 return out->device<=INT64_MAX&&out->inode<=INT64_MAX&&out->nlink<=INT64_MAX;
}
/* Decoding authentic wire data is necessary, never a source of authority.
 * The caller must already hold the original client/io and verified MAC. */
static int nr_io_identity_decode(const unsigned char *p,size_t size,nr_root_store_identity *out){
 if(size!=NR_ROOT_IDENTITY_WIRE_BYTES||!p||!out)return 0;
 memset(out,0,sizeof(*out));out->format=nr_io_u32(p);out->birth_state=nr_io_u32(p+4);
 if(out->format!=2||out->birth_state<NR_CREATED||out->birth_state>NR_BOUND)return 0;
 memcpy(out->namespace_id,p+8,32);memcpy(out->birth_id,p+40,32);memcpy(out->pool_id,p+72,32);memcpy(out->claim_id,p+104,32);
 memcpy(out->anchor_digest,p+136,32);memcpy(out->profile_digest,p+168,32);memcpy(out->receipt_head,p+200,32);
 out->receipt_sequence=nr_io_u64(p+232);out->main_principal_uid=nr_io_u32(p+240);out->file_owner_uid=nr_io_u32(p+244);
 if(!nr_io_fact(p+248,&out->directory)||!nr_io_fact(p+280,&out->database)||!nr_io_fact(p+312,&out->issuer_lock))return 0;
 out->journal_generation=nr_io_u64(p+344);out->journal_state=nr_io_u32(p+352);out->journal_present=nr_io_u32(p+356);
 memcpy(out->journal_ticket,p+360,32);if(!nr_io_fact(p+392,&out->journal))return 0;
 if(!nr_io_nonzero(out->namespace_id)||!nr_io_nonzero(out->birth_id)||!nr_io_nonzero(out->anchor_digest)||
    !nr_io_nonzero(out->profile_digest)||!nr_io_nonzero(out->receipt_head)||!out->receipt_sequence||out->receipt_sequence>INT64_MAX||
    !out->main_principal_uid||out->directory.uid!=out->file_owner_uid||out->database.uid!=out->file_owner_uid||out->issuer_lock.uid!=out->file_owner_uid||
    !S_ISDIR(out->directory.mode)||!S_ISREG(out->database.mode)||!S_ISREG(out->issuer_lock.mode)||
    (out->directory.mode&07777)!=0700||(out->database.mode&07777)!=0600||(out->issuer_lock.mode&07777)!=0600||
    out->directory.nlink<1||out->database.nlink!=1||out->issuer_lock.nlink!=1||
    out->journal_state>NR_JOURNAL_DELETE_PENDING||out->journal_present>1||out->journal_generation>INT64_MAX)return 0;
 if(out->birth_state==NR_CREATED){if(nr_io_nonzero(out->pool_id)||nr_io_nonzero(out->claim_id))return 0;}
 else if(!nr_io_nonzero(out->pool_id)||!nr_io_nonzero(out->claim_id))return 0;
 if(out->journal_present&&(!out->journal_generation||!S_ISREG(out->journal.mode)||out->journal.nlink!=1||
    out->journal.uid!=out->file_owner_uid||(out->journal.mode&07777)!=0600))return 0;
 return 1;
}
static int nr_io_fact_same(const nr_root_file_fact *a,const nr_root_file_fact *b){
 return a->device==b->device&&a->inode==b->inode&&a->uid==b->uid&&a->mode==b->mode&&a->nlink==b->nlink;
}
static int nr_io_identity_same(const nr_root_store_identity *a,const nr_root_store_identity *b){
 return a->format==b->format&&a->main_principal_uid==b->main_principal_uid&&a->file_owner_uid==b->file_owner_uid&&
  !memcmp(a->namespace_id,b->namespace_id,32)&&!memcmp(a->birth_id,b->birth_id,32)&&!memcmp(a->pool_id,b->pool_id,32)&&
  !memcmp(a->claim_id,b->claim_id,32)&&!memcmp(a->anchor_digest,b->anchor_digest,32)&&!memcmp(a->profile_digest,b->profile_digest,32)&&
  nr_io_fact_same(&a->directory,&b->directory)&&nr_io_fact_same(&a->database,&b->database)&&nr_io_fact_same(&a->issuer_lock,&b->issuer_lock);
}
#endif
