/* Same original translation unit, exact contiguous function group. Not a public header. */
/* Cross-DSO routing stores original opaque identities, never copied keys or
 * layout-cast producer rows. The only importer is the fixed CPP capsule path. */
typedef struct imported_store_file {struct imported_store_file *next;nr_root_store_file *original;} imported_store_file;
typedef struct imported_store {struct imported_store *next;nr_root_store_io *original;const nm_root_store_dispatch *ops;pid_t pid;pthread_t thread;const nr_root_bootstrap_claim *claim;imported_store_file *files;} imported_store;
static _Thread_local imported_store *imported_stores;
static imported_store *imported_io(nr_root_store_io *p){
 for(imported_store *r=imported_stores;r;r=r->next)if(r->original==p)return r->pid==getpid()&&pthread_equal(r->thread,pthread_self())?r:NULL;
 return NULL;
}
static imported_store *imported_file(nr_root_store_file *p){
 for(imported_store *r=imported_stores;r;r=r->next)for(imported_store_file *f=r->files;f;f=f->next)
  if(f->original==p)return r->pid==getpid()&&pthread_equal(r->thread,pthread_self())?r:NULL;
 return NULL;
}
static int retain_imported_file(imported_store *r,nr_root_store_file *p){
 if(!p)return 1;
 for(imported_store_file *f=r->files;f;f=f->next)if(f->original==p)return 1;
 imported_store_file *f=calloc(1,sizeof(*f));if(!f)return 0;f->original=p;f->next=r->files;r->files=f;return 1;
}
int nm_installed_import_root_store(const nm_root_store_dispatch *ops,nr_root_store_io *io){
 if(!ops||!io||ops->magic!=NR_STORE_DISPATCH_MAGIC||ops->version!=NR_STORE_DISPATCH_VERSION||ops->bytes!=sizeof(*ops))return 0;
 imported_store *prior=imported_io(io);if(prior)return prior->ops==ops;
 if(!ops->read_adoption_kind||!ops->claim_adopted||!ops->read_adoption)return 0;
 if(!ops->read_identity)return 0;
 if(!ops->claim_fresh)return 0;
 if(!ops->read_claim)return 0;
 if(!ops->bind_bootstrap)return 0;
 if(!ops->open_database)return 0;
 if(!ops->open_journal)return 0;
 if(!ops->create_journal)return 0;
 if(!ops->read_at)return 0;
 if(!ops->write_at)return 0;
 if(!ops->size)return 0;
 if(!ops->truncate)return 0;
 if(!ops->sync)return 0;
 if(!ops->close_file)return 0;
 if(!ops->delete_journal)return 0;
 if(!ops->directory_sync)return 0;
 if(!ops->release_owned)return 0;
 imported_store *r=calloc(1,sizeof(*r));if(!r)return 0;
 r->original=io;r->ops=ops;r->pid=getpid();r->thread=pthread_self();r->next=imported_stores;imported_stores=r;return 1;
}

/* Fixed v2 RootDB SPI. The numbered operations are the reviewed v2 wire
 * contract, not a caller operation interface or a v1 compatibility mapper. */

static nr_root_store_io *store_member(nr_root_store_io *candidate){
 if(candidate&&candidate==worker_store)return candidate;
 for(nr_root_store_io *p=root_stores;p;p=p->next)if(p==candidate)return p;
 return NULL;
}
static nr_root_store_file *store_file(nr_root_store_file *candidate){
 if(worker_store)for(nr_root_store_file *f=worker_store->files;f;f=f->next)if(f==candidate)return f;
 for(nr_root_store_io *io=root_stores;io;io=io->next)
  for(nr_root_store_file *f=io->files;f;f=f->next)if(f==candidate)return f;
 return NULL;
}
static int store_failed(nr_root_store_io *io,int code){
 if(io){io->unknown=1;unknown(io->client,code);}return 0;
}
static int store_association(nr_root_store_io *io){
 if(!store_member(io)||io->released||io->pid!=getpid()||!pthread_equal(io->thread,pthread_self()))return 0;
 return original_member(io->client);
}
static int store_alive(nr_root_store_io *io,int negative){
 if(!store_association(io))return 0;
 nm_installed_client *p=io->client;
 if(!negative&&(io->unknown||p->fate.unknown))return 0;
 return p->fate.connected&&!p->fate.closed&&!p->channels[0].close_attempted&&p->channels[0].key_valid&&channel_peer(p,p->channels);
}
static int authority_exchange(nr_root_store_io *io,uint16_t op,const unsigned char *body,uint32_t size,unsigned char *output,size_t capacity,mi_frame *reply){
 nm_installed_client *p=io->client;nm_channel *c=p->channels;
 if(!store_alive(io,op==MI_AUTHORITY_RELEASE)||c->next_sequence==UINT64_MAX)return store_failed(io,EPERM);
 mi_frame request={0};request.domain=p->ks_role==2?MI_BROKER_IO:p->ks_role?MI_KSWARM_IO:MI_ROOT_IO;request.operation=op;request.sequence=c->next_sequence;request.payload_length=size;memcpy(request.nonce,p->birth.nonce,32);
 uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 if(!mi_wire_send(c->fd,c->key,&request,body,deadline)||!mi_wire_receive(c->fd,c->key,reply,output,capacity,deadline)||
    reply->domain!=(p->ks_role==2?MI_BROKER_IO:p->ks_role?MI_KSWARM_IO:MI_ROOT_IO)||reply->operation!=(op|MI_RESPONSE)||reply->sequence!=request.sequence||reply->slot||reply->offset||reply->amount||reply->status||memcmp(reply->nonce,p->birth.nonce,32))return store_failed(io,EPROTO);
 c->next_sequence++;return 1;
}
static int authority_result(nr_root_store_io *io,const unsigned char *bytes,uint32_t length,mi_frame *reply,unsigned char *output,size_t capacity){
 if(length<MI_AUTHORITY_RESULT_PREFIX)return store_failed(io,EPROTO);
 uint32_t kind=nr_io_u32(bytes),code=nr_io_u32(bytes+4),amount=nr_io_u32(bytes+16),size=nr_io_u32(bytes+20);
 if(size!=length-MI_AUTHORITY_RESULT_PREFIX||size>capacity)return store_failed(io,EPROTO);
 if(kind!=MI_AUTHORITY_OK){if(kind==MI_AUTHORITY_KNOWN_DENIED||kind==MI_AUTHORITY_BUSY_HELD){errno=(int)code;return 0;}return store_failed(io,code?code:EIO);}
 if(code)return store_failed(io,EPROTO);
 reply->offset=nr_io_u64(bytes+8);reply->amount=amount;reply->payload_length=size;
 if(size)memcpy(output,bytes+MI_AUTHORITY_RESULT_PREFIX,size);return 1;
}
static int authority_request(nr_root_store_io *io,uint16_t operation,uint16_t slot,uint64_t offset,const unsigned char *body,uint32_t size,uint32_t amount,mi_frame *reply,unsigned char *output,size_t capacity){
 if(size>MI_AUTHORITY_MAX_INNER||amount>MI_AUTHORITY_MAX_READ)return store_failed(io,EINVAL);
 unsigned char request[MI_MAX_PAYLOAD],bytes[MI_MAX_PAYLOAD];memcpy(request,io->authority_token,32);request[32]=(unsigned char)(operation>>8);request[33]=(unsigned char)operation;request[34]=(unsigned char)(slot>>8);request[35]=(unsigned char)slot;nr_io_put64(request+36,offset);nr_io_put32(request+44,amount);nr_io_put32(request+48,size);if(size)memcpy(request+52,body,size);
 mi_frame wire={0};if(!authority_exchange(io,MI_AUTHORITY_REQUEST,request,52+size,bytes,sizeof(bytes),&wire)||!authority_result(io,bytes,wire.payload_length,reply,output,capacity))return 0;
 return 1;
}
static int store_request(nr_root_store_io *io,uint16_t operation,uint16_t slot,uint64_t offset,
 const unsigned char *body,uint32_t size,uint32_t amount,mi_frame *reply,unsigned char *output,size_t capacity){
 if(io->family)return authority_request(io,operation,slot,offset,body,size,amount,reply,output,capacity);
 int negative=operation==MI_JOURNAL_CLOSE;
 if(MI_PROTOCOL_VERSION!=2||size>MI_MAX_PAYLOAD||amount>MI_MAX_PAYLOAD||!store_alive(io,negative))return 0;
 nm_installed_client *p=io->client;nm_channel *channel=p->channels;
 if(channel->next_sequence==UINT64_MAX)return store_failed(io,EOVERFLOW);
 mi_frame request={0};request.domain=MI_ROOT_IO;request.operation=operation;request.slot=slot;
 request.sequence=channel->next_sequence;request.offset=offset;request.payload_length=size;request.amount=amount;
 memcpy(request.nonce,p->birth.nonce,32);uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 if(!original_member(p)||!mi_wire_send(channel->fd,channel->key,&request,body,deadline)||
    !mi_wire_receive(channel->fd,channel->key,reply,output,capacity,deadline)||
    reply->domain!=MI_ROOT_IO||reply->operation!=(operation|MI_RESPONSE)||reply->slot!=slot||reply->sequence!=request.sequence||
    memcmp(reply->nonce,p->birth.nonce,32)||reply->status){channel->unknown=1;return store_failed(io,errno?errno:EPROTO);}
 channel->next_sequence++;return 1;
}
static int read_store_identity(nr_root_store_io *io,nr_root_store_identity *out,int initial){
 unsigned char bytes[NR_ROOT_IDENTITY_WIRE_BYTES];mi_frame reply={0};
 if(!store_request(io,MI_STORE_IDENTITY,MI_SLOT_NONE,0,NULL,0,0,&reply,bytes,sizeof(bytes))||
    reply.offset||reply.amount||!nr_io_identity_decode(bytes,reply.payload_length,out))return store_failed(io,EPROTO);
 if(out->main_principal_uid!=io->client->birth.uid||(!initial&&(!nr_io_identity_same(&io->identity,out)||
    out->birth_state<io->identity.birth_state||out->receipt_sequence<io->identity.receipt_sequence)))return store_failed(io,EPROTO);
 io->identity=*out;return 1;
}
int nm_installed_borrow_root_store(nm_installed_client *client,nr_root_store_io **out){
 NM_CLIENT_GUARD(client,0);
 if(!out||client->ks_role||MI_PROTOCOL_VERSION!=2||!nm_installed_current(client)||client->root_store)return 0;
 nr_root_store_io *io=calloc(1,sizeof(*io));if(!io)return 0;
 io->client=client;io->pid=getpid();io->thread=pthread_self();io->next=root_stores;root_stores=io;client->root_store=io;
 nr_root_store_identity identity;
 if(!read_store_identity(io,&identity,1))return 0;
 *out=io;return 1;
}
static int borrow_authority_store(nm_installed_client *client,uint32_t family,const unsigned char scope[32],nr_root_store_io **out,int *known_denied){
 if(known_denied)*known_denied=0;
 NM_CLIENT_GUARD(client,0);
 if(!out||!scope||!nm_installed_current(client)||!client->root_store||client->root_store->identity.birth_state!=NR_BOUND||family<MI_FAMILY_ADMISSION||family>MI_FAMILY_BROKER)return 0;
 nr_root_store_io *io=calloc(1,sizeof(*io));if(!io)return 0;
 io->client=client;io->pid=getpid();io->thread=pthread_self();io->family=family;memcpy(io->scope,scope,32);io->authority_hold=1;client->authority_holds++;
 io->next=root_stores;root_stores=io;
 unsigned char body[36],bytes[MI_AUTHORITY_OPEN_REPLY_BYTES];nr_io_put32(body,family);memcpy(body+4,scope,32);mi_frame reply={0};
 if(!authority_exchange(io,MI_AUTHORITY_OPEN,body,sizeof(body),bytes,sizeof(bytes),&reply))return 0;
 if(reply.payload_length<24)return store_failed(io,EPROTO);
 uint32_t kind=nr_io_u32(bytes),length=nr_io_u32(bytes+20);
 if(kind==MI_AUTHORITY_KNOWN_DENIED){
  uint32_t code=nr_io_u32(bytes+4);
  if(reply.payload_length!=MI_AUTHORITY_RESULT_PREFIX||length||nr_io_u64(bytes+8)||nr_io_u32(bytes+16)||!code||code>INT_MAX)return store_failed(io,EPROTO);
  io->released=1;io->authority_hold=0;client->authority_holds--;if(known_denied)*known_denied=1;errno=(int)code;return 0;
 }
 if(kind!=MI_AUTHORITY_OK||nr_io_u32(bytes+4)||nr_io_u64(bytes+8)||nr_io_u32(bytes+16)||length!=456||reply.payload_length!=480||!nr_io_identity_decode(bytes+56,424,&io->identity))return store_failed(io,EPROTO);
 memcpy(io->authority_token,bytes+24,32);
 /* CREATED has no claim/pool yet. The original helper assigns the existing
  * Root pool at CLAIM; reopened CLAIMED/BOUND must already match it. */
 if(!nr_io_nonzero(io->authority_token)||(io->identity.birth_state!=NR_CREATED&&memcmp(io->identity.pool_id,client->root_store->identity.pool_id,32))||io->identity.main_principal_uid!=client->birth.uid)return store_failed(io,EPROTO);
 *out=io;return 1;
}
#ifdef MI_FIXTURE_BUILD
int nm_fixture_borrow_authority_store(nm_installed_client *client,uint32_t family,const unsigned char scope[32],nr_root_store_io **out){return borrow_authority_store(client,family,scope,out,NULL);}
#endif
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
int nr_component_borrow_original_root_store(nm_installed_client *client,nr_root_store_io **out){
 return nm_installed_borrow_root_store(client,out);
}
#endif
int nr_root_store_read_identity(nr_root_store_io *io,nr_root_store_identity *out){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->read_identity(io,out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 return out&&store_member(io)&&read_store_identity(io,out,0);
}
int nr_root_store_claim_fresh(nr_root_store_io *io,const nr_root_bootstrap_claim **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->claim_fresh(io,out);if(ok)remote->claim=*out;return ok;}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!out||!store_association(io)||io->unknown||io->client->close_requested)return 0;
 if(io->claim.valid){if(io->claim.kind!=1)return 0;*out=&io->claim;return store_alive(io,0);}
 if(io->identity.birth_state!=NR_CREATED)return 0;
 unsigned char bytes[NR_ROOT_IDENTITY_WIRE_BYTES];mi_frame reply={0};nr_root_store_identity next;
 if(!store_request(io,MI_CLAIM_FRESH,MI_SLOT_NONE,0,NULL,0,0,&reply,bytes,sizeof(bytes))||reply.offset||reply.amount||
    !nr_io_identity_decode(bytes,reply.payload_length,&next)||next.birth_state!=NR_CLAIMED||
    memcmp(next.namespace_id,io->identity.namespace_id,32)||memcmp(next.birth_id,io->identity.birth_id,32)||
    memcmp(next.anchor_digest,io->identity.anchor_digest,32)||memcmp(next.profile_digest,io->identity.profile_digest,32)||
    !nr_io_fact_same(&next.directory,&io->identity.directory)||!nr_io_fact_same(&next.database,&io->identity.database)||
    !nr_io_fact_same(&next.issuer_lock,&io->identity.issuer_lock)||next.main_principal_uid!=io->identity.main_principal_uid||
    next.file_owner_uid!=io->identity.file_owner_uid||next.receipt_sequence<=io->identity.receipt_sequence||
    (io->family&&(io->client->ks_role?memcmp(next.pool_id,io->client->ks_pool,32):(!io->client->root_store||memcmp(next.pool_id,io->client->root_store->identity.pool_id,32)))))return store_failed(io,EPROTO);
 io->identity=next;io->claim.io=io;io->claim.identity=next;io->claim.valid=1;io->claim.kind=1;*out=&io->claim;return 1;
}
int nr_root_store_read_claim(nr_root_store_io *io,const nr_root_bootstrap_claim *claim,nr_root_store_identity *out){
 imported_store *remote=imported_io(io);if(remote){if(claim!=remote->claim)return 0;return remote->ops->read_claim(io,claim,out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!out||!store_association(io)||claim!=&io->claim||!io->claim.valid||io->claim.kind!=1||io->claim.io!=io)return 0;
 *out=io->claim.identity;return 1;
}
int nr_root_store_bind_bootstrap(nr_root_store_io *io,enum nr_root_bind_mode mode,
 const nr_root_bootstrap_claim *claim,const nr_root_store_identity *verified){
 imported_store *remote=imported_io(io);if(remote){if(claim&&claim!=remote->claim)return 0;return remote->ops->bind_bootstrap(io,mode,claim,verified);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!verified||!store_association(io)||io->unknown||(mode!=NR_FRESH_COMMIT&&mode!=NR_RECOVER_COMMITTED&&mode!=NR_ADOPTION_COMMITTED)||
    !nr_io_identity_same(&io->identity,verified)||io->identity.birth_state<NR_CLAIMED||
    (mode==NR_FRESH_COMMIT&&(claim!=&io->claim||!io->claim.valid||io->claim.kind!=1))||
    (mode==NR_ADOPTION_COMMITTED&&(claim!=&io->claim||!io->claim.valid||io->claim.kind!=2))||(mode==NR_RECOVER_COMMITTED&&claim))return 0;
 unsigned char body[164],bytes[NR_ROOT_IDENTITY_WIRE_BYTES];mi_frame reply={0};nr_root_store_identity next;
 nr_io_put32(body,(uint32_t)mode);memcpy(body+4,verified->namespace_id,32);memcpy(body+36,verified->pool_id,32);
 memcpy(body+68,verified->claim_id,32);memcpy(body+100,verified->anchor_digest,32);memcpy(body+132,verified->profile_digest,32);
 if(!store_request(io,MI_BIND_BOOTSTRAP,MI_SLOT_NONE,0,body,sizeof(body),0,&reply,bytes,sizeof(bytes))||reply.offset||reply.amount||
    !nr_io_identity_decode(bytes,reply.payload_length,&next)||next.birth_state!=NR_BOUND||!nr_io_identity_same(&io->identity,&next)||
    next.receipt_sequence<io->identity.receipt_sequence)return store_failed(io,EPROTO);
 io->identity=next;return 1;
}

#include "root-store-adopted-claim-private.h"
