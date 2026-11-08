#ifndef XIAOK_BROKER_CHILD_CLIENT_PRIVATE_H
#define XIAOK_BROKER_CHILD_CLIENT_PRIVATE_H
int nm_installed_connect_broker_child(nm_installed_client *p,nr_root_store_io **out){
 NM_CLIENT_GUARD(p,0);if(!out||p->fate.attempted||p->fate.unknown||p->root_store)return 0;p->fate.attempted=1;p->ks_role=2;
 struct stat st;int descriptor=fcntl(MI_BIRTH_FD,F_GETFD),flags=fcntl(MI_BIRTH_FD,F_GETFL);
 if(descriptor<0||flags<0||fstat(MI_BIRTH_FD,&st)||!S_ISFIFO(st.st_mode)||(flags&O_ACCMODE)!=O_RDONLY||(descriptor&FD_CLOEXEC)){error_first(p,EBADF);p->fate.closed=1;return 0;}
 p->seed_fd=MI_BIRTH_FD;p->fate.entered=1;unsigned char bytes[MI_BROKER_BIRTH_BYTES],extra;memset(bytes,0,sizeof(bytes));uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 int good=!fcntl(p->seed_fd,F_SETFD,descriptor|FD_CLOEXEC)&&!fcntl(p->seed_fd,F_SETFL,flags|O_NONBLOCK)&&mi_read_exact(p->seed_fd,bytes,sizeof(bytes),deadline)&&mi_birth_decode(bytes,&p->birth)&&p->birth.child_pid==(uint32_t)getpid()&&p->birth.uid==(uint32_t)getuid()&&getuid()==geteuid()&&nr_io_u32(bytes+88)==(uint32_t)getppid();
 if(good){errno=0;good=!mi_read_exact(p->seed_fd,&extra,1,deadline)&&errno==EPIPE;}
 if(!good)unknown(p,errno?errno:EPROTO);if(!close_seed(p))good=0;
 nr_root_store_io *io=NULL;
 if(good){
  io=calloc(1,sizeof(*io));if(!io){unknown(p,ENOMEM);good=0;}else{
   io->client=p;io->pid=getpid();io->thread=pthread_self();io->family=MI_FAMILY_BROKER;io->authority_hold=1;p->authority_holds++;
   memcpy(io->authority_token,bytes+92,32);memcpy(io->scope,bytes+124,32);memcpy(p->ks_pool,bytes+156,32);io->next=root_stores;root_stores=io;
   if(!nr_io_nonzero(io->authority_token)||!nr_io_nonzero(p->ks_pool)){unknown(p,EPROTO);good=0;}
  }
 }
 if(good){nm_channel *c=p->channels;good=mi_connect_fixed_domain(&p->birth,MI_BROKER_IO,&c->fd,c->key,c->release);if(good)c->key_valid=1;else{c->unknown=1;unknown(p,errno);}}
 mi_zero(bytes,sizeof(bytes));mi_zero(p->birth.seed,sizeof(p->birth.seed));
 if(!good){nm_installed_close_owned(p);return 0;}p->fate.connected=1;
 nr_root_store_identity identity;if(!read_store_identity(io,&identity,1)||(identity.birth_state!=NR_CREATED&&memcmp(identity.pool_id,p->ks_pool,32))){store_failed(io,EPROTO);return 0;}
 *out=io;return 1;
}
int nm_broker_child_bind_namespace_current(nm_installed_client *p){
 NM_CLIENT_GUARD(p,0);if(!p->ks_role||!nm_installed_current(p))return 0;
 nr_root_store_io *io=NULL;for(nr_root_store_io *r=root_stores;r;r=r->next)if(r->client==p&&r->family==MI_FAMILY_BROKER){if(io)return 0;io=r;}
 nr_root_store_identity identity;if(!io||!nr_root_store_read_identity(io,&identity))return 0;
 return nr_root_store_bind_bootstrap(io,io->claim.valid?NR_FRESH_COMMIT:NR_RECOVER_COMMITTED,io->claim.valid?&io->claim:NULL,&identity);
}
#endif
