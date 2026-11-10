#ifndef XIAOK_MAIN_INSTALLATION_ROOT_STORE_IO_H
#define XIAOK_MAIN_INSTALLATION_ROOT_STORE_IO_H
/* Included only in the original helper. All file names are fixed here. */
#define STORE_RECEIPTS "birth.receipts"
#define STORE_ANCHOR "namespace.bin"
#define STORE_MAX_RECORDS UINT64_C(1048576)
#ifdef MI_ORIGINAL_ADOPTION_ENTRY
static int store_adoption_reply(state *,mi_store_lease *,mi_frame *,unsigned char *);
static int store_adoption_bind(state *,mi_store_lease *,const unsigned char *);
static int store_adoption_close_entry(state *,mi_store_lease *);
#endif
static int store_adoption_presence(state *s,mi_store_lease *l){
 struct stat fact;
 if(!fstatat(l->authority,"adoption.bin",&fact,AT_SYMLINK_NOFOLLOW))return 1;
 if(errno==ENOENT)return 0;
 l->unknown=1;s->unknown=1;return -1;
}
static int close_file_lease(state *s);
static void store_lease_init(mi_store_lease *l){memset(l,0,sizeof(*l));l->authority=l->parent=l->anchor_fd=l->validation_fd=l->store.receipt_fd=-1;for(int i=0;i<4;i++)l->files[i]=-1;for(int i=0;i<2;i++)l->ancestors[i]=-1;}
static void store_mark_unknown(state *s,mi_store_lease *l){(void)s;l->unknown=1;if(l==&s->root_store)s->unknown=1;}

/* Preserve every entered descriptor even when close itself is unknown. */
static int store_close_fd(state *s,mi_store_lease *l,int *fd){
 int original=*fd;if(close_owned(fd))return 1;int error=errno;store_mark_unknown(s,l);
 if(!l->close_error_present){l->close_error_present=1;l->close_error=error;}
 if(l->failed_close_count<10){int at=l->failed_close_count++;l->failed_close_fds[at]=original;l->failed_close_codes[at]=error;}return 0;
}
static uint32_t st_u32(const unsigned char *p){return (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
static uint64_t st_u64(const unsigned char *p){uint64_t n=0;for(int i=0;i<8;i++)n=n<<8|p[i];return n;}
static void st_p32(unsigned char *p,uint32_t n){for(int i=3;i>=0;i--){p[i]=(unsigned char)n;n>>=8;}}
static void st_p64(unsigned char *p,uint64_t n){for(int i=7;i>=0;i--){p[i]=(unsigned char)n;n>>=8;}}
static int st_nonzero(const unsigned char *p,size_t n){unsigned v=0;for(size_t i=0;i<n;i++)v|=p[i];return v!=0;}
static void st_hash(const void *p,size_t n,unsigned char out[32]){CC_SHA256(p,(CC_LONG)n,out);}
static int st_nonce(unsigned char p[32]){return mi_random(p,32)&&st_nonzero(p,32);}
static void st_fact(unsigned char *p,const struct stat *s){st_p64(p,(uint64_t)s->st_dev);st_p64(p+8,(uint64_t)s->st_ino);st_p32(p+16,(uint32_t)s->st_uid);st_p32(p+20,(uint32_t)s->st_mode);st_p64(p+24,(uint64_t)s->st_nlink);}
static int __attribute__((unused)) st_same_fact(const unsigned char *p,const struct stat *s){unsigned char f[32];st_fact(f,s);return !memcmp(p,f,32);}
/* Directory nlink is birth audit, not live identity (APFS counts entries). */
static int __attribute__((unused)) st_same_directory(const unsigned char *p,const struct stat *s){return st_u64(p)==(uint64_t)s->st_dev&&st_u64(p+8)==(uint64_t)s->st_ino&&st_u32(p+16)==(uint32_t)s->st_uid&&st_u32(p+20)==(uint32_t)s->st_mode&&st_u64(p+24)>0&&st_u64(p+24)<=INT64_MAX;}
static int st_decode_fact(const unsigned char *p,struct stat *s,uid_t uid){
 uint64_t dev=st_u64(p),ino=st_u64(p+8),links=st_u64(p+24);uint32_t mode=st_u32(p+20);
 if(dev>INT64_MAX||ino>INT64_MAX||links!=1||st_u32(p+16)!=(uint32_t)uid||!S_ISREG(mode)||(mode&07777)!=0600)return 0;
 memset(s,0,sizeof(*s));s->st_dev=(dev_t)dev;s->st_ino=(ino_t)ino;s->st_uid=uid;s->st_mode=(mode_t)mode;s->st_nlink=(nlink_t)links;return (uint64_t)s->st_dev==dev&&(uint64_t)s->st_ino==ino;
}
static int __attribute__((unused)) st_exact_read(int fd,void *p,size_t n,off_t offset){unsigned char *b=p;size_t at=0;while(at<n){ssize_t k=pread(fd,b+at,n-at,offset+(off_t)at);if(k>0)at+=(size_t)k;else if(k<0&&errno==EINTR)continue;else return 0;}return 1;}
static int st_absent(state *s,mi_store_lease *l,const char *name){(void)s;struct stat v;return fstatat(l->authority,name,&v,AT_SYMLINK_NOFOLLOW)<0&&errno==ENOENT;}
static int store_sidecars_absent(state *s,mi_store_lease *l){(void)s;return st_absent(s,l,l->wal_name)&&st_absent(s,l,l->shm_name);}
static void store_identity(state *s,mi_store_lease *l,unsigned char out[MI_STORE_IDENTITY_BYTES]){(void)s;
 mi_store_state *q=&l->store;memset(out,0,MI_STORE_IDENTITY_BYTES);st_p32(out,2);st_p32(out+4,(uint32_t)q->phase);
 memcpy(out+8,q->namespace_id,32);memcpy(out+40,q->birth_id,32);memcpy(out+72,q->pool_id,32);memcpy(out+104,q->claim_id,32);memcpy(out+136,q->anchor_digest,32);memcpy(out+168,q->profile,32);memcpy(out+200,q->head,32);st_p64(out+232,q->sequence);st_p32(out+240,s->birth.uid);st_p32(out+244,(uint32_t)l->file_identity[MI_DATABASE].st_uid);
 memcpy(out+248,q->anchor+176,32);st_fact(out+280,&l->file_identity[MI_DATABASE]);st_fact(out+312,&l->file_identity[MI_ISSUER_LOCK]);st_p64(out+344,q->generation);st_p32(out+352,(uint32_t)q->journal_state);st_p32(out+356,q->journal_state?1u:0u);
 if(q->journal_state){memcpy(out+360,st_nonzero(q->ticket,32)?q->ticket:q->audit_ticket,32);st_fact(out+392,&l->file_identity[MI_JOURNAL]);}
}
#include "root-store-receipts.h"
static int store_delete_pending(state *s,mi_store_lease *l){(void)s;
 mi_store_state *q=&l->store;l->io_entered=1;struct stat named;int result=fstatat(l->authority,l->journal_name,&named,AT_SYMLINK_NOFOLLOW);
 if(!result){if(!identity(&named,&l->file_identity[MI_JOURNAL])||unlinkat(l->authority,l->journal_name,0))return 0;}else if(errno!=ENOENT)return 0;
 if(fsync(l->authority)||!store_append(s,l,7,(uint32_t)q->phase))return 0;q->last_closed_known=0;mi_zero(q->ticket,32);return 1;
}
static int store_open_at(state *s,mi_store_lease *l){(void)s;
 uid_t owner=getuid();l->io_entered=1;
 int created=mkdirat(l->parent,l->directory_name,0700)==0;if(!created&&errno!=EEXIST)return 0;
 l->authority=openat(l->parent,l->directory_name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(l->authority<0||fstat(l->authority,&l->authority_identity)||(l->authority_identity.st_mode&07777)!=0700||l->authority_identity.st_uid!=owner||!safe_acl(l->authority))return 0;
 const char *names[]={NULL,l->database_name,NULL,"issuer.lock"};
 for(int i=1;i<=3;i++){if(i==MI_JOURNAL)continue;l->files[i]=openat(l->authority,names[i],O_RDWR|O_NOFOLLOW|O_CLOEXEC|(created?(O_CREAT|O_EXCL):0),0600);if(l->files[i]<0||!regular_owned(l->files[i],owner,l->file_identity+i))return 0;}
 if(flock(l->files[MI_ISSUER_LOCK],LOCK_EX|LOCK_NB)||!store_sidecars_absent(s,l))return 0;
 mi_store_state *q=&l->store;const unsigned char *expected_profile=l->expected_profile;
 l->anchor_fd=openat(l->authority,STORE_ANCHOR,(created?(O_RDWR|O_CREAT|O_EXCL):O_RDONLY)|O_NOFOLLOW|O_CLOEXEC,0600);int anchor=l->anchor_fd;if(anchor<0)return 0;int good=regular_owned(anchor,owner,&q->anchor_identity);
 if(created){
  good=good&&st_nonce(q->namespace_id)&&st_nonce(q->birth_id);memcpy(q->profile,expected_profile,32);memcpy(q->anchor,"XMANCH02",8);st_p32(q->anchor+8,2);st_p32(q->anchor+12,320);memcpy(q->anchor+16,q->namespace_id,32);memcpy(q->anchor+48,q->birth_id,32);memcpy(q->anchor+80,s->release,32);memcpy(q->anchor+112,q->profile,32);
  /* Fixture authorization is compile-time isolated and cannot attest production. */
  static const char auth[]="fixture-only-original-dual-oexcl";st_hash(auth,sizeof(auth)-1,q->anchor+144);st_fact(q->anchor+176,&l->authority_identity);st_fact(q->anchor+208,&l->file_identity[MI_DATABASE]);st_fact(q->anchor+240,&l->file_identity[MI_ISSUER_LOCK]);st_p32(q->anchor+272,(uint32_t)getpid());st_p32(q->anchor+276,s->birth.uid);st_p32(q->anchor+280,owner);st_p32(q->anchor+284,MI_BUILD_KIND);st_hash(q->anchor,288,q->anchor+288);
  good=good&&!fsync(l->files[MI_DATABASE])&&!fsync(l->files[MI_ISSUER_LOCK])&&!fsync(l->authority)&&!fsync(l->parent)&&mi_write_exact(anchor,q->anchor,320,mi_now_ms()+1000)&&!fsync(anchor)&&!fsync(l->authority);
 }else{
  good=good&&q->anchor_identity.st_size==320&&st_exact_read(anchor,q->anchor,320,0);unsigned char hash[32];st_hash(q->anchor,288,hash);
  good=good&&!memcmp(q->anchor,"XMANCH02",8)&&st_u32(q->anchor+8)==2&&st_u32(q->anchor+12)==320&&!memcmp(hash,q->anchor+288,32)&&!memcmp(q->anchor+80,s->release,32)&&!memcmp(q->anchor+112,expected_profile,32)&&st_u32(q->anchor+276)==s->birth.uid&&st_u32(q->anchor+280)==owner&&st_u32(q->anchor+284)==MI_BUILD_KIND&&st_same_directory(q->anchor+176,&l->authority_identity)&&st_same_fact(q->anchor+208,&l->file_identity[MI_DATABASE])&&st_same_fact(q->anchor+240,&l->file_identity[MI_ISSUER_LOCK]);
  memcpy(q->namespace_id,q->anchor+16,32);memcpy(q->birth_id,q->anchor+48,32);memcpy(q->profile,q->anchor+112,32);
 }
 memcpy(q->anchor_digest,q->anchor+288,32);if(!store_close_fd(s,l,&l->anchor_fd))good=0;if(!good)return 0;
 q->receipt_fd=openat(l->authority,STORE_RECEIPTS,O_RDWR|O_NOFOLLOW|O_CLOEXEC|(created?(O_CREAT|O_EXCL):0),0600);if(q->receipt_fd<0||!regular_owned(q->receipt_fd,owner,&q->receipt_identity))return 0;
 if(created){if(!store_append(s,l,1,1)||fsync(l->authority)||fsync(l->parent))return 0;}
 else{
  off_t n=q->receipt_identity.st_size;if(n<=0||n%512||(uint64_t)n/512>STORE_MAX_RECORDS)return 0;
  for(off_t at=0;at<n;at+=512){unsigned char b[512];if(!st_exact_read(q->receipt_fd,b,512,at)||!store_apply(s,l,b))return 0;}
 }
 if(l->family!=MI_FAMILY_ROOT_NMP&&q->phase>=2&&memcmp(q->pool_id,s->root_store.store.pool_id,32))return 0;
 if(q->journal_state==2){if(!store_delete_pending(s,l))return 0;}
 else if(q->journal_state==1){l->validation_fd=openat(l->authority,l->journal_name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);int fd=l->validation_fd;struct stat fact;good=fd>=0&&regular_owned(fd,owner,&fact)&&identity(&fact,&l->file_identity[MI_JOURNAL]);if(!store_close_fd(s,l,&l->validation_fd))good=0;if(!good)return 0;}
 else if(!st_absent(s,l,l->journal_name))return 0;
 q->last_closed_known=0;mi_zero(q->ticket,32);return 1;
}
static int store_open_namespace(state *s,mi_store_lease *l){(void)s;
#ifndef MI_FIXTURE_BUILD
 (void)s;(void)l;errno=EPERM;return 0;
#else
 s->birth.uid=(uint32_t)getuid();s->root=checked_chain(MI_FIXED_ROOT,0);uid_t owner=getuid();if(s->root<0||fstat(s->root,&s->root_identity)||s->root_identity.st_uid!=owner||(s->root_identity.st_mode&0022))return 0;
 l->parent=s->root;l->family=MI_FAMILY_ROOT_NMP;memcpy(l->directory_name,MI_AUTHORITY_BASENAME,sizeof(MI_AUTHORITY_BASENAME));memcpy(l->database_name,MI_DATABASE_BASENAME,sizeof(MI_DATABASE_BASENAME));
 snprintf(l->journal_name,sizeof(l->journal_name),"%s-journal",l->database_name);snprintf(l->wal_name,sizeof(l->wal_name),"%s-wal",l->database_name);snprintf(l->shm_name,sizeof(l->shm_name),"%s-shm",l->database_name);
 static const char profile[]="xiaok-original-root-store-io-v2";st_hash(profile,sizeof(profile)-1,l->expected_profile);return store_open_at(s,l);
#endif
}
static int store_current(state *s,mi_store_lease *l){(void)s;
 mi_store_state *q=&l->store;if(!store_sidecars_absent(s,l))return 0;
 struct stat named,held;if(fstatat(l->authority,STORE_ANCHOR,&named,AT_SYMLINK_NOFOLLOW)||!identity(&named,&q->anchor_identity)||named.st_size!=320)return 0;
 if(!l->closed&&(q->receipt_fd<0||fstat(q->receipt_fd,&held)||fstatat(l->authority,STORE_RECEIPTS,&named,AT_SYMLINK_NOFOLLOW)||!identity(&named,&held)||!identity(&held,&q->receipt_identity)||held.st_size!=(off_t)(q->sequence*512)||!safe_acl(q->receipt_fd)))return 0;
 if(q->journal_state==1){if(fstatat(l->authority,l->journal_name,&named,AT_SYMLINK_NOFOLLOW)||!identity(&named,&l->file_identity[MI_JOURNAL]))return 0;}else if(!q->journal_state&&!st_absent(s,l,l->journal_name))return 0;return 1;
}
static int store_ticket(state *s,mi_store_lease *l,const unsigned char *p){(void)s;return st_u64(p)==l->store.generation&&st_nonzero(l->store.ticket,32)&&!memcmp(p+8,l->store.ticket,32);}
static int store_journal_close(state *s,mi_store_lease *l){(void)s;
 mi_store_state *q=&l->store;if(q->last_closed_known&&l->files[MI_JOURNAL]<0)return 1;if(l->files[MI_JOURNAL]<0)return 0;
 l->io_entered=1;int original=l->files[MI_JOURNAL];if(!close_owned(l->files+MI_JOURNAL)){store_mark_unknown(s,l);if(s->failed_close_count<16)s->failed_close_fds[s->failed_close_count++]=original;return 0;}q->last_closed_known=1;
 return store_append(s,l,5,(uint32_t)q->phase);
}
static int store_reply_identity(state *s,mi_store_lease *l,mi_frame *r,unsigned char *output){(void)s;store_identity(s,l,output);r->payload_length=424;r->amount=0;r->offset=0;return 1;}
static int store_io(state *s,mi_store_lease *l,const mi_frame *f,const unsigned char *input,mi_frame *r,unsigned char *output){(void)s;
 mi_store_state *q=&l->store;if(f->status||(f->operation&MI_RESPONSE)||f->operation==MI_HELLO||f->offset>INT64_MAX)return 0;r->payload_length=r->amount=0;r->offset=f->offset;
 if(f->operation==MI_PING||f->operation==MI_CLOSE){if(f->slot||f->payload_length||f->amount||f->offset)return 0;if(f->operation==MI_CLOSE&&f->domain==MI_ROOT_IO){
 int good=1,first=0;
#ifdef MI_ORIGINAL_ADOPTION_ENTRY
 if(!store_adoption_close_entry(s,l)){good=0;first=errno;}
#endif
 if(!close_file_lease(s)){if(good)first=errno;good=0;}
 if(!good)r->status=(uint32_t)(first?first:EIO);
}return 1;}
 if(f->domain!=MI_ROOT_IO)return 0;
 if(f->operation==MI_CLAIM_ADOPTED){
  if(l!=&s->root_store||f->slot||f->payload_length||f->amount||f->offset)return 0;
  int adoption=store_adoption_presence(s,l);
  if(adoption<0)return 0;
  if(!adoption)return store_reply_identity(s,l,r,output);
#ifdef MI_ORIGINAL_ADOPTION_ENTRY
  return store_adoption_reply(s,l,r,output);
#else
  /* No Entry/transport producer is linked in this original helper build. */
  return 0;
#endif
 }
 if(f->operation==MI_STORE_IDENTITY){if(f->slot||f->payload_length||f->amount||f->offset)return 0;return store_reply_identity(s,l,r,output);}
 if(f->operation==MI_CLAIM_FRESH){
  if(f->slot||f->payload_length||f->amount||f->offset||q->phase!=1)return 0;
  l->io_entered=1;if(l->family==MI_FAMILY_ROOT_NMP){if(!st_nonce(q->pool_id))return 0;}else{if(s->root_store.store.phase!=3)return 0;memcpy(q->pool_id,s->root_store.store.pool_id,32);}if(!st_nonce(q->claim_id)||!store_append(s,l,2,2))return 0;return store_reply_identity(s,l,r,output);
 }
 if(f->operation==MI_BIND_BOOTSTRAP){
  if(f->slot||f->payload_length!=164||f->amount||f->offset||q->phase<2)return 0;uint32_t mode=st_u32(input);
  int adoption=store_adoption_presence(s,l);
  if(adoption<0||((mode==1||mode==2)&&adoption))return 0;
  if(mode==3){
#ifdef MI_ORIGINAL_ADOPTION_ENTRY
   return adoption&&store_adoption_bind(s,l,input)&&store_reply_identity(s,l,r,output);
#else
   return 0;
#endif
  }
  if((mode!=1&&mode!=2)||memcmp(input+4,q->namespace_id,32)||memcmp(input+36,q->pool_id,32)||memcmp(input+68,q->claim_id,32)||memcmp(input+100,q->anchor_digest,32)||memcmp(input+132,q->profile,32)||(mode==1&&(q->claim_pid!=(uint32_t)s->child||memcmp(q->claim_nonce,s->birth.nonce,32))))return 0;
  if(q->phase==2&&!store_append(s,l,3,3))return 0;return store_reply_identity(s,l,r,output);
 }
 if(f->operation==MI_DIRECTORY_SYNC){if(f->slot!=MI_DATABASE||f->payload_length||f->amount||f->offset)return 0;l->io_entered=1;if(fsync(l->authority))r->status=(uint32_t)errno;return 1;}
 if(q->phase<2||f->slot==MI_SLOT_NONE||f->slot>MI_JOURNAL)return 0;
 if(f->operation==MI_JOURNAL_EXISTS){if(f->slot!=MI_JOURNAL||f->payload_length||f->amount||f->offset)return 0;r->amount=q->journal_state?1:0;return 1;}
 if(f->operation==MI_JOURNAL_CREATE||f->operation==MI_JOURNAL_OPEN_EXISTING){
  int create=f->operation==MI_JOURNAL_CREATE;uint32_t mode=create?2:(f->payload_length==4?st_u32(input):0);
  if(f->slot!=MI_JOURNAL||f->offset||f->amount||(create?f->payload_length!=0:f->payload_length!=4)||(mode!=1&&mode!=2)||l->files[MI_JOURNAL]>=0)return 0;
  if(!create&&!q->journal_state){if(!st_absent(s,l,l->journal_name))return 0;mi_zero(q->ticket,32);return store_reply_identity(s,l,r,output);}
  if((create&&q->journal_state)||(!create&&q->journal_state!=1)||q->generation>=INT64_MAX)return 0;
  l->io_entered=1;int fd=openat(l->authority,l->journal_name,(mode==1?O_RDONLY:O_RDWR)|O_NOFOLLOW|O_CLOEXEC|(create?(O_CREAT|O_EXCL):0),0600);if(fd<0)return 0;l->files[MI_JOURNAL]=fd;
  struct stat actual;if(!regular_owned(fd,l->file_identity[MI_DATABASE].st_uid,&actual)||(!create&&!identity(&actual,&l->file_identity[MI_JOURNAL]))||!st_nonce(q->ticket))return 0;
  q->journal_readonly=mode==1;q->last_closed_known=0;
  if(create){l->file_identity[MI_JOURNAL]=actual;if(fsync(fd)||fsync(l->authority)||!store_append(s,l,4,(uint32_t)q->phase))return 0;}
  return store_reply_identity(s,l,r,output);
 }
 int journal=f->slot==MI_JOURNAL;size_t prefix=journal?40:0;
 if(f->payload_length<prefix||(journal&&!store_ticket(s,l,input)))return 0;
 if(f->operation==MI_JOURNAL_CLOSE){if(!journal||f->payload_length!=40||f->amount||f->offset||!store_journal_close(s,l))return 0;return 1;}
 if(f->operation==MI_JOURNAL_DELETE){if(!journal||f->payload_length!=40||f->amount||f->offset||q->journal_state!=1||!store_journal_close(s,l)||!st_nonce(q->operation)||!store_append(s,l,6,(uint32_t)q->phase)||!store_delete_pending(s,l))return 0;return 1;}
 int fd=l->files[f->slot];if(fd<0)return 0;
 switch(f->operation){
 case MI_READ:{if(f->payload_length!=prefix||!f->amount||f->offset>INT64_MAX-f->amount)return 0;l->io_entered=1;ssize_t n;do{n=pread(fd,output,f->amount,(off_t)f->offset);}while(n<0&&errno==EINTR);if(n<0)r->status=(uint32_t)errno;else r->payload_length=(uint32_t)n;return 1;}
 case MI_WRITE:{if((journal&&q->journal_readonly)||!f->amount||f->payload_length!=prefix+f->amount||f->offset>INT64_MAX-f->amount)return 0;l->io_entered=1;size_t at=0;while(at<f->amount){ssize_t n=pwrite(fd,input+prefix+at,f->amount-at,(off_t)(f->offset+at));if(n>0)at+=(size_t)n;else if(n<0&&errno==EINTR)continue;else{r->status=(uint32_t)(errno?errno:EIO);break;}}r->amount=(uint32_t)at;return 1;}
 case MI_SIZE:{if(f->payload_length!=prefix||f->amount||f->offset)return 0;l->io_entered=1;struct stat actual;if(fstat(fd,&actual)||actual.st_size<0)r->status=(uint32_t)(errno?errno:EIO);else r->offset=(uint64_t)actual.st_size;return 1;}
 case MI_TRUNCATE:if((journal&&q->journal_readonly)||f->payload_length!=prefix||f->amount)return 0;l->io_entered=1;if(ftruncate(fd,(off_t)f->offset))r->status=(uint32_t)errno;return 1;
 case MI_SYNC:if(f->payload_length!=prefix||f->amount||f->offset)return 0;l->io_entered=1;if(fsync(fd))r->status=(uint32_t)errno;return 1;
 default:return 0;
 }
}
#endif
