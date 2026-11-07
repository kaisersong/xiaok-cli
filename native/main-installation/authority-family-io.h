#ifndef XIAOK_MAIN_INSTALLATION_AUTHORITY_FAMILY_IO_H
#define XIAOK_MAIN_INSTALLATION_AUTHORITY_FAMILY_IO_H
/* Original helper-only dispatch. Tokens and file descriptors never enter JS. */
static const char *authority_family_name(uint32_t family){switch(family){case MI_FAMILY_ADMISSION:return "admission";case MI_FAMILY_BUDGET:return "budget";case MI_FAMILY_KSWARM:return "kswarm";case MI_FAMILY_BROKER:return "broker";default:return NULL;}}
static const char *authority_database_name(uint32_t family){switch(family){case MI_FAMILY_ADMISSION:return "groups.sqlite";case MI_FAMILY_BUDGET:return "harness-optimization.sqlite";case MI_FAMILY_KSWARM:return "state.sqlite";case MI_FAMILY_BROKER:return "broker.sqlite";default:return NULL;}}
static int authority_scope_authorized(uint32_t family,const unsigned char scope[32]){
#if defined(MI_FIXTURE_BUILD) && defined(MI_FIXTURE_AUTHORITY_SCOPES)
 if(!authority_family_name(family))return 0;unsigned a=0,b=0;for(size_t i=0;i<32;i++){a|=scope[i]^0x11u;b|=scope[i]^0x22u;}return a==0||b==0;
#else
 /* An authenticated Main is not a canonical genesis/migration enrollment. */
 (void)family;(void)scope;return 0;
#endif
}
static int authority_result(mi_frame *r,unsigned char *out,uint32_t kind,uint32_t error,uint64_t offset,uint32_t amount,const unsigned char *data,uint32_t size){
 if(kind>MI_AUTHORITY_BUSY_HELD||size>MI_AUTHORITY_MAX_READ||(size&&!data))return 0;
 r->status=r->slot=r->amount=0;r->offset=0;r->payload_length=MI_AUTHORITY_RESULT_PREFIX+size;
 st_p32(out,kind);st_p32(out+4,error);st_p64(out+8,offset);st_p32(out+16,amount);st_p32(out+20,size);if(size)memmove(out+24,data,size);return 1;
}
static mi_store_lease *authority_token(state *s,const unsigned char token[32]){if(!st_nonzero(token,32))return NULL;for(size_t i=0;i<s->family_count;i++)if(!memcmp(s->families[i].token,token,32))return s->families+i;return NULL;}
static int authority_close(state *s,mi_store_lease *l){
 if(l->closed){if(l->unknown)errno=l->close_error_present?l->close_error:EIO;return !l->unknown;}l->closed=1;int good=1;
 for(int i=1;i<=3;i++)if(!store_close_fd(s,l,l->files+i))good=0;
 if(!store_close_fd(s,l,&l->store.receipt_fd))good=0;
 if(!store_close_fd(s,l,&l->anchor_fd))good=0;
 if(!store_close_fd(s,l,&l->validation_fd))good=0;
 if(!store_close_fd(s,l,&l->authority))good=0;
 for(int i=1;i>=0;i--)if(!store_close_fd(s,l,l->ancestors+i))good=0;
 if(!good||l->unknown)errno=l->close_error_present?l->close_error:EIO;return good&&!l->unknown;
}
static int authority_open_directory(state *s,mi_store_lease *l,int parent,const char *name,int index){
 l->io_entered=1;int created=mkdirat(parent,name,0700)==0;if(!created&&errno!=EEXIST)return 0;
 int fd=openat(parent,name,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);l->ancestors[index]=fd;
 struct stat *fact=l->ancestor_identity+index;
 if(fd<0||fstat(fd,fact)||!S_ISDIR(fact->st_mode)||(fact->st_mode&07777)!=0700||fact->st_uid!=getuid()||!safe_acl(fd))return 0;
 if(created&&(fsync(fd)||fsync(parent)))return 0;(void)s;return 1;
}
static int authority_current(state *s,mi_store_lease *l){
 if(l->closed||l->unknown)return 0;struct stat actual,named;int parent=s->root;const char *names[]={"authority-families",authority_family_name(l->family)};
 for(int i=0;i<2;i++){int fd=l->ancestors[i];if(fd<0||fstat(fd,&actual)||fstatat(parent,names[i],&named,AT_SYMLINK_NOFOLLOW)||!directory_identity(&actual,l->ancestor_identity+i)||!directory_identity(&actual,&named)||!safe_acl(fd))goto failed;parent=fd;}
 if(fstat(l->authority,&actual)||fstatat(parent,l->directory_name,&named,AT_SYMLINK_NOFOLLOW)||!directory_identity(&actual,&l->authority_identity)||!directory_identity(&named,&actual)||!safe_acl(l->authority))goto failed;
 const char *file_names[]={NULL,l->database_name,l->journal_name,"issuer.lock"};
 for(int i=1;i<=3;i++){if(i==MI_JOURNAL&&l->files[i]<0)continue;if(fstat(l->files[i],&actual)||fstatat(l->authority,file_names[i],&named,AT_SYMLINK_NOFOLLOW)||!identity(&actual,l->file_identity+i)||!identity(&actual,&named)||!safe_acl(l->files[i]))goto failed;}
 if(!store_current(s,l))goto failed;return 1;
failed:store_mark_unknown(s,l);return 0;
}
static int authority_open(state *s,const unsigned char *input,mi_frame *r,unsigned char *output){
 uint32_t family=st_u32(input);const unsigned char *scope=input+4;
 if(s->authority_sealed||s->root_store.closed||s->root_store.store.phase!=3||!authority_scope_authorized(family,scope))return authority_result(r,output,MI_AUTHORITY_KNOWN_DENIED,EPERM,0,0,NULL,0);
 for(size_t i=0;i<s->family_count;i++){mi_store_lease *l=s->families+i;if(l->family!=family||memcmp(l->scope,scope,32))continue;
  if(l->closed||l->unknown)return authority_result(r,output,l->unknown?MI_AUTHORITY_UNKNOWN_HELD:MI_AUTHORITY_KNOWN_DENIED,EPERM,0,0,NULL,0);
  if(!authority_current(s,l))return authority_result(r,output,MI_AUTHORITY_UNKNOWN_HELD,EIO,0,0,NULL,0);
  unsigned char data[456];memcpy(data,l->token,32);store_identity(s,l,data+32);return authority_result(r,output,MI_AUTHORITY_OK,0,0,0,data,sizeof(data));
 }
 struct rlimit limit;if(s->family_count>=MI_AUTHORITY_MAX_LEASES||getrlimit(RLIMIT_NOFILE,&limit)||((uint64_t)s->family_count+1)*8+32>limit.rlim_cur)return authority_result(r,output,MI_AUTHORITY_KNOWN_DENIED,EMFILE,0,0,NULL,0);
 /* The private row exists before the first random/FS SDK. Never remove it. */
 mi_store_lease *l=s->families+s->family_count++;l->family=family;memcpy(l->scope,scope,32);
 int unique=0;for(int attempt=0;attempt<4&&!unique;attempt++){if(!st_nonce(l->token))break;unique=1;for(size_t i=0;i+1<s->family_count;i++)if(!memcmp(s->families[i].token,l->token,32))unique=0;}
 if(!unique){store_mark_unknown(s,l);return authority_result(r,output,MI_AUTHORITY_UNKNOWN_HELD,EIO,0,0,NULL,0);}
 for(size_t i=0;i<32;i++)snprintf(l->directory_name+2*i,3,"%02x",scope[i]);
 const char *database=authority_database_name(family);snprintf(l->database_name,sizeof(l->database_name),"%s",database);snprintf(l->journal_name,sizeof(l->journal_name),"%s-journal",database);snprintf(l->wal_name,sizeof(l->wal_name),"%s-wal",database);snprintf(l->shm_name,sizeof(l->shm_name),"%s-shm",database);
 static const char domain[]="xiaok-authority-family-io-v1";unsigned char profile[sizeof(domain)+4+32];memcpy(profile,domain,sizeof(domain));st_p32(profile+sizeof(domain),family);memcpy(profile+sizeof(domain)+4,scope,32);st_hash(profile,sizeof(profile),l->expected_profile);
 int good=authority_open_directory(s,l,s->root,"authority-families",0)&&authority_open_directory(s,l,l->ancestors[0],authority_family_name(family),1);l->parent=l->ancestors[1];
 if(good)good=store_open_at(s,l);
 if(good&&l->store.phase>=2)good=!memcmp(l->store.pool_id,s->root_store.store.pool_id,32);
 if(!good){int original=errno?errno:EIO;store_mark_unknown(s,l);authority_close(s,l);return authority_result(r,output,MI_AUTHORITY_UNKNOWN_HELD,(uint32_t)original,0,0,NULL,0);}
 unsigned char data[456];memcpy(data,l->token,32);store_identity(s,l,data+32);return authority_result(r,output,MI_AUTHORITY_OK,0,0,0,data,sizeof(data));
}
static int authority_inner_allowed(uint16_t operation){switch(operation){case MI_STORE_IDENTITY:case MI_CLAIM_FRESH:case MI_BIND_BOOTSTRAP:case MI_READ:case MI_WRITE:case MI_SIZE:case MI_TRUNCATE:case MI_SYNC:case MI_JOURNAL_EXISTS:case MI_JOURNAL_CREATE:case MI_JOURNAL_DELETE:case MI_DIRECTORY_SYNC:case MI_JOURNAL_OPEN_EXISTING:case MI_JOURNAL_CLOSE:return 1;default:return 0;}}
static int authority_io(state *s,const mi_frame *f,const unsigned char *input,mi_frame *r,unsigned char *output){
 if(f->domain!=MI_ROOT_IO||f->slot||f->offset||f->amount||f->status)return 0;
 if(f->operation==MI_AUTHORITY_OPEN){if(f->payload_length!=36)return 0;return authority_open(s,input,r,output);}
 if(f->operation==MI_AUTHORITY_RELEASE){if(f->payload_length!=32)return 0;mi_store_lease *l=authority_token(s,input);if(!l)return authority_result(r,output,MI_AUTHORITY_KNOWN_DENIED,EPERM,0,0,NULL,0);int good=authority_close(s,l);return authority_result(r,output,good?MI_AUTHORITY_OK:MI_AUTHORITY_UNKNOWN_HELD,good?0:EIO,0,0,NULL,0);}
 if(f->operation!=MI_AUTHORITY_REQUEST||f->payload_length<MI_AUTHORITY_REQUEST_PREFIX)return 0;
 uint32_t n=st_u32(input+48);mi_frame inner={0};inner.domain=MI_ROOT_IO;inner.operation=(uint16_t)((uint16_t)input[32]<<8|input[33]);inner.slot=(uint16_t)((uint16_t)input[34]<<8|input[35]);inner.offset=st_u64(input+36);inner.amount=st_u32(input+44);inner.payload_length=n;
 if(n>MI_AUTHORITY_MAX_INNER||f->payload_length!=MI_AUTHORITY_REQUEST_PREFIX+n||!authority_inner_allowed(inner.operation)||inner.amount>MI_AUTHORITY_MAX_READ||inner.slot>MI_JOURNAL)return authority_result(r,output,MI_AUTHORITY_KNOWN_DENIED,EINVAL,0,0,NULL,0);
 mi_store_lease *l=authority_token(s,input);int negative=inner.operation==MI_JOURNAL_CLOSE;
 if(!l||l->closed||(!negative&&(s->authority_sealed||l->unknown)))return authority_result(r,output,l&&l->unknown?MI_AUTHORITY_UNKNOWN_HELD:MI_AUTHORITY_KNOWN_DENIED,EPERM,0,0,NULL,0);
 if(!negative&&!authority_current(s,l))return authority_result(r,output,MI_AUTHORITY_UNKNOWN_HELD,EIO,0,0,NULL,0);
 mi_frame answer={0};l->io_entered=0;int good=store_io(s,l,&inner,input+MI_AUTHORITY_REQUEST_PREFIX,&answer,output+MI_AUTHORITY_RESULT_PREFIX);int error=answer.status?answer.status:(errno?errno:EINVAL);
 if(!good||answer.status){if(l->io_entered||answer.status||l->unknown)store_mark_unknown(s,l);return authority_result(r,output,l->unknown?MI_AUTHORITY_UNKNOWN_HELD:MI_AUTHORITY_KNOWN_DENIED,(uint32_t)error,0,0,NULL,0);}
 if(l->unknown)return authority_result(r,output,MI_AUTHORITY_UNKNOWN_HELD,EIO,0,0,NULL,0);
 return authority_result(r,output,MI_AUTHORITY_OK,0,answer.offset,answer.amount,output+MI_AUTHORITY_RESULT_PREFIX,answer.payload_length);
}
#endif
