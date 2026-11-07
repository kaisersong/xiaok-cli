/* Same original Main's Native-only installation transport. No file descriptor,
 * key, seed, arbitrary operation or path crosses into JavaScript. */
#define _DARWIN_C_SOURCE
#include "installed-main-client.h"
#include "../main-installation/wire.h"
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <pthread.h>
#include <time.h>
#include <stdatomic.h>
#include <CommonCrypto/CommonDigest.h>
#include "installed-budget-worker-io.h"
#include "root-store-io-codec.h"
#include "root-store-io-dispatch.h"
struct nr_root_store_io;
static int root_store_held(struct nr_root_store_io *);
typedef struct nm_channel {
 int fd,close_attempted,local_closed,remote_closed,key_valid,unknown;
 unsigned char key[32],release[32];uint64_t next_sequence;
} nm_channel;
struct nm_installed_client {
 struct nm_installed_client *next;nm_installed_fate fate;
 int seed_fd,seed_close_attempted;
 pid_t creator_pid;
 int close_requested,core_budget_attempted,core_admission_attempted;
 pthread_mutex_t io_mutex;int mutex_ready,queue_failed;
 unsigned authority_holds,worker_holds; /* reserve before each family/Worker SDK */
 struct nr_root_store_io *root_store;
 mi_birth birth;nm_channel channels[2];
};
struct nr_root_store_file {
 struct nr_root_store_file *next;nr_root_store_io *io;
 uint16_t slot;int readonly,closed;uint64_t generation;
 unsigned char ticket[32];
};
struct nr_root_bootstrap_claim {
 nr_root_store_io *io;nr_root_store_identity identity;int valid;
};
struct nr_root_store_io {
 struct nr_root_store_io *next;nm_installed_client *client;
 pid_t pid;pthread_t thread;int released,unknown,main_opened,open_files;
 uint32_t family;unsigned char authority_token[32],scope[32];int authority_hold;
 nr_root_store_identity identity;nr_root_store_file *files;
 nr_root_store_file *database,*journal_owner;
 struct nr_root_bootstrap_claim claim;
};
static _Thread_local nr_root_store_io *root_stores;
static _Thread_local nr_root_store_io *worker_store;
static _Thread_local nm_installed_client *worker_client;
static int root_store_held(nr_root_store_io *io){return io&&!io->released;}
static _Thread_local nm_installed_client *clients;
static int member(nm_installed_client *p){if(p&&worker_client==p)return 1;for(nm_installed_client *r=clients;r;r=r->next)if(r==p)return 1;return 0;}
static void error_first(nm_installed_client *p,int code){if(!p->fate.error_present){p->fate.error_present=1;p->fate.error_code=code;}}
static void unknown(nm_installed_client *p,int code){p->fate.unknown=1;error_first(p,code);}
/* Only this process's inherited descriptor copies are closed. Never send a
 * CLOSE frame or shutdown the parent's shared socket from a fork child. */
static void close_child_copies(nm_installed_client *p){
 unknown(p,EPERM);p->fate.connected=0;p->fate.root_files_closed=0;
 if(p->seed_fd>=0&&!p->seed_close_attempted){
  p->seed_close_attempted=1;
  if(close(p->seed_fd)==0)p->fate.seed_closed=1;
 }
 int local_closed=1;
 for(int i=0;i<2;i++){
  nm_channel *c=p->channels+i;
  if(c->fd>=0&&!c->close_attempted){c->close_attempted=1;if(close(c->fd)==0)c->local_closed=1;}
  if(c->fd>=0&&!c->local_closed)local_closed=0;
  c->key_valid=0;c->unknown=1;c->remote_closed=0;
  mi_zero(c->key,sizeof(c->key));
 }
 mi_zero(p->birth.seed,sizeof(p->birth.seed));
 if(local_closed&&(p->seed_fd<0||p->fate.seed_closed))p->fate.closed=1;
}
static int original_process(nm_installed_client *p){
 pid_t actual=getpid();
 return p->creator_pid==actual&&(!p->birth.child_pid||p->birth.child_pid==(uint32_t)actual);
}
static int original_member(nm_installed_client *p){
 if(!member(p))return 0;
 if(!original_process(p)){close_child_copies(p);return 0;}
 return 1;
}
/* One bounded native arbiter covers whole frames and all shared client state.
 * PID/member checks precede locks, including negative cleanup after raw fork. */
typedef struct nm_client_guard {nm_installed_client *client;int held;} nm_client_guard;
static int client_enter(nm_installed_client *p){
 if(!original_member(p)||!p->mutex_ready)return 0;
 uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 for(;;){int code=pthread_mutex_trylock(&p->io_mutex);if(!code)break;
  if(code!=EBUSY||mi_now_ms()>=deadline){__atomic_store_n(&p->queue_failed,1,__ATOMIC_RELEASE);errno=code==EBUSY?ETIMEDOUT:code;return 0;}
  struct timespec pause={0,1000000};nanosleep(&pause,NULL);
 }
 if(__atomic_load_n(&p->queue_failed,__ATOMIC_ACQUIRE))unknown(p,ETIMEDOUT);
 return 1;
}
static void client_leave(nm_client_guard *g){if(g->held){g->held=0;pthread_mutex_unlock(&g->client->io_mutex);}}
#define NM_CLIENT_GUARD(p,failure) nm_client_guard nm_guard __attribute__((cleanup(client_leave)))={(p),client_enter(p)};if(!nm_guard.held)return (failure)
static void after_fork_child(void){
 int saved=errno;
 if(worker_client)close_child_copies(worker_client);
 for(nm_installed_client *p=clients;p;p=p->next)close_child_copies(p);
 errno=saved;
}
static pthread_once_t atfork_once=PTHREAD_ONCE_INIT;
static int atfork_error;
static void register_fork_cleanup(void){atfork_error=pthread_atfork(NULL,NULL,after_fork_child);}
nm_installed_client *nm_installed_create(void){
 nm_installed_client *p=calloc(1,sizeof(*p));if(!p)return NULL;p->seed_fd=-1;p->creator_pid=getpid();
 for(int i=0;i<2;i++){p->channels[i].fd=-1;p->channels[i].next_sequence=1;}
 pthread_mutexattr_t attr;int mutex_error=pthread_mutexattr_init(&attr);
 if(!mutex_error){mutex_error=pthread_mutexattr_settype(&attr,PTHREAD_MUTEX_RECURSIVE);if(!mutex_error)mutex_error=pthread_mutex_init(&p->io_mutex,&attr);pthread_mutexattr_destroy(&attr);}
 p->mutex_ready=!mutex_error;
 p->next=clients;clients=p;
 if(mutex_error){unknown(p,mutex_error);p->fate.closed=1;}
 int registered=pthread_once(&atfork_once,register_fork_cleanup);
 if(registered||atfork_error){unknown(p,registered?registered:atfork_error);p->fate.closed=1;}
 return p;
}
static int close_seed(nm_installed_client *p){
 if(p->seed_fd<0)return 1;if(p->seed_close_attempted)return p->fate.seed_closed;
 p->seed_close_attempted=1;int rc=close(p->seed_fd),code=errno;
 if(rc){unknown(p,code);return 0;}p->fate.seed_closed=1;return 1;
}
static int response_matches(const nm_installed_client *p,const mi_frame *r,int domain,int operation,uint64_t seq){
 return r->domain==domain&&r->operation==(operation|MI_RESPONSE)&&r->status==0&&r->slot==MI_SLOT_NONE&&r->sequence==seq&&r->offset==0&&r->payload_length==0&&r->amount==0&&!memcmp(r->nonce,p->birth.nonce,32);
}
static int channel_peer(nm_installed_client *p,nm_channel *c){
 if(!original_member(p))return 0;
 uint32_t pid=0,uid=0;int good=c->fd>=0&&mi_peer_identity(c->fd,&pid,&uid)&&pid==p->birth.helper_pid;
#ifdef MI_FIXTURE_BUILD
 good=good&&uid==(uint32_t)getuid();
#else
 good=good&&uid==0;
#endif
 if(!good){c->unknown=1;unknown(p,errno);}return good;
}
static int exchange(nm_installed_client *p,int i,int operation){
 if(!original_member(p))return 0;
 nm_channel *c=p->channels+i;if(c->fd<0||!c->key_valid||c->close_attempted||c->next_sequence==UINT64_MAX||!channel_peer(p,c)){unknown(p,EOVERFLOW);return 0;}
 mi_frame request={0},reply={0};request.domain=(uint8_t)(i+1);request.operation=(uint16_t)operation;request.sequence=c->next_sequence;memcpy(request.nonce,p->birth.nonce,32);
 unsigned char payload[MI_MAX_PAYLOAD];uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 int good=mi_wire_send(c->fd,c->key,&request,NULL,deadline)&&mi_wire_receive(c->fd,c->key,&reply,payload,sizeof(payload),deadline)&&response_matches(p,&reply,i+1,operation,c->next_sequence);mi_zero(payload,sizeof(payload));
 if(!good){c->unknown=1;unknown(p,errno);return 0;}c->next_sequence++;return 1;
}
int nm_installed_connect(nm_installed_client *p){
 NM_CLIENT_GUARD(p,0);
 if(!original_member(p)||p->fate.attempted||p->fate.unknown)return 0;p->fate.attempted=1;
 /* The row predates fstat/read/connect. Reject ordinary unrelated descriptors
  * before claiming ownership; an inherited birth is an uncloexec readonly pipe. */
 struct stat seed;int descriptor_flags=fcntl(MI_BIRTH_FD,F_GETFD),flags=fcntl(MI_BIRTH_FD,F_GETFL);
 if(descriptor_flags<0||flags<0||fstat(MI_BIRTH_FD,&seed)||!S_ISFIFO(seed.st_mode)||(flags&O_ACCMODE)!=O_RDONLY||(descriptor_flags&FD_CLOEXEC)){error_first(p,EBADF);p->fate.closed=1;return 0;}
 p->fate.entered=1;p->seed_fd=MI_BIRTH_FD;
 int good=fcntl(p->seed_fd,F_SETFD,descriptor_flags|FD_CLOEXEC)==0&&fcntl(p->seed_fd,F_SETFL,flags|O_NONBLOCK)==0;
 unsigned char bytes[MI_BIRTH_BYTES],extra=0;memset(bytes,0,sizeof(bytes));uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 if(good)good=mi_read_exact(p->seed_fd,bytes,sizeof(bytes),deadline)&&mi_birth_decode(bytes,&p->birth)&&p->birth.child_pid==(uint32_t)getpid()&&p->birth.uid==(uint32_t)getuid()&&getuid()==geteuid();
 if(good){errno=0;int trailing=mi_read_exact(p->seed_fd,&extra,1,deadline);good=!trailing&&errno==EPIPE;}
 if(!good)unknown(p,errno);
 mi_zero(bytes,sizeof(bytes));if(!close_seed(p))good=0;
 for(int i=0;i<2&&good;i++){
  nm_channel *c=p->channels+i;
  good=mi_connect_fixed_domain(&p->birth,(uint8_t)(i+1),&c->fd,c->key,c->release);
  if(good)c->key_valid=1;else {c->unknown=1;unknown(p,errno);}
 }
 if(good&&memcmp(p->channels[0].release,p->channels[1].release,32)){unknown(p,EPROTO);good=0;}
 mi_zero(p->birth.seed,sizeof(p->birth.seed));
 if(!good){nm_installed_close_owned(p);return 0;}
 p->fate.connected=1;return 1;
}
int nm_installed_current(nm_installed_client *p){NM_CLIENT_GUARD(p,0);return original_member(p)&&!p->close_requested&&p->fate.connected&&!p->fate.closed&&!p->fate.unknown&&!p->channels[0].close_attempted&&!p->channels[1].close_attempted&&channel_peer(p,p->channels)&&channel_peer(p,p->channels+1);}
int nm_installed_ping(nm_installed_client *p){
 NM_CLIENT_GUARD(p,0);
 if(!nm_installed_current(p))return 0;
 for(int i=0;i<2;i++)if(!exchange(p,i,MI_PING))return 0;return 1;
}
int nm_installed_close_owned(nm_installed_client *p){
 NM_CLIENT_GUARD(p,0);
 if(!original_member(p))return 0;int good=close_seed(p);
 if(root_store_held(p->root_store)||p->authority_holds||p->worker_holds){p->close_requested=1;return 0;}
 /* Negative cleanup deliberately does not ask a revoked positive Source. */
 for(int i=0;i<2;i++){
  nm_channel *c=p->channels+i;if(c->fd<0)continue;
  if(!c->close_attempted){
   if(c->key_valid&&!c->unknown){if(exchange(p,i,MI_CLOSE))c->remote_closed=1;else good=0;}
   else good=0;
   c->close_attempted=1;int rc=close(c->fd),code=errno;
   if(rc){unknown(p,code);good=0;}else c->local_closed=1;
   if(c->remote_closed&&c->local_closed)mi_zero(c->key,sizeof(c->key));
  }else if(!c->local_closed||!c->remote_closed)good=0;
 }
 int all_local=1;for(int i=0;i<2;i++)if(p->channels[i].fd>=0&&!p->channels[i].local_closed)all_local=0;
 if(all_local&&(p->seed_fd<0||p->fate.seed_closed))p->fate.closed=1;
 /* The fixed helper's root_io CLOSE ACK follows actual attempt-all file
  * closes. This is narrower than helper/process/infrastructure termination. */
 if(p->channels[0].remote_closed&&p->channels[0].local_closed&&!p->fate.unknown)p->fate.root_files_closed=1;
 return good&&p->fate.closed&&!p->fate.unknown;
}
int nm_installed_fate_read(nm_installed_client *p,nm_installed_fate *out){
 if(!member(p)||!out)return 0;
 if(!original_process(p)){close_child_copies(p);*out=p->fate;return 1;}
 NM_CLIENT_GUARD(p,0);
 *out=p->fate;out->root_sequence=p->channels[0].next_sequence-1;out->dispatch_sequence=p->channels[1].next_sequence-1;return 1;
}
void nm_installed_release(nm_installed_client *p){
 if(!original_member(p))return;
 nm_client_guard nm_guard __attribute__((cleanup(client_leave)))={p,client_enter(p)};if(!nm_guard.held)return;
 nm_installed_close_owned(p);
 /* Unknown is held for this process; no absent handle/timeout becomes known. */
 if(!p->fate.closed||p->fate.unknown)return;
 nm_installed_client **at=&clients;while(*at&&*at!=p)at=&(*at)->next;if(*at)*at=p->next;
 client_leave(&nm_guard);pthread_mutex_destroy(&p->io_mutex);mi_zero(p,sizeof(*p));free(p);
}

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
 if(!ops||!io)return 0;
 imported_store *prior=imported_io(io);if(prior)return prior->ops==ops;
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
 mi_frame request={0};request.domain=MI_ROOT_IO;request.operation=op;request.sequence=c->next_sequence;request.payload_length=size;memcpy(request.nonce,p->birth.nonce,32);
 uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 if(!mi_wire_send(c->fd,c->key,&request,body,deadline)||!mi_wire_receive(c->fd,c->key,reply,output,capacity,deadline)||
    reply->domain!=MI_ROOT_IO||reply->operation!=(op|MI_RESPONSE)||reply->sequence!=request.sequence||reply->slot||reply->offset||reply->amount||reply->status||memcmp(reply->nonce,p->birth.nonce,32))return store_failed(io,EPROTO);
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
 if(!out||MI_PROTOCOL_VERSION!=2||!nm_installed_current(client)||client->root_store)return 0;
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
 if(io->claim.valid){*out=&io->claim;return store_alive(io,0);}
 if(io->identity.birth_state!=NR_CREATED)return 0;
 unsigned char bytes[NR_ROOT_IDENTITY_WIRE_BYTES];mi_frame reply={0};nr_root_store_identity next;
 if(!store_request(io,MI_CLAIM_FRESH,MI_SLOT_NONE,0,NULL,0,0,&reply,bytes,sizeof(bytes))||reply.offset||reply.amount||
    !nr_io_identity_decode(bytes,reply.payload_length,&next)||next.birth_state!=NR_CLAIMED||
    memcmp(next.namespace_id,io->identity.namespace_id,32)||memcmp(next.birth_id,io->identity.birth_id,32)||
    memcmp(next.anchor_digest,io->identity.anchor_digest,32)||memcmp(next.profile_digest,io->identity.profile_digest,32)||
    !nr_io_fact_same(&next.directory,&io->identity.directory)||!nr_io_fact_same(&next.database,&io->identity.database)||
    !nr_io_fact_same(&next.issuer_lock,&io->identity.issuer_lock)||next.main_principal_uid!=io->identity.main_principal_uid||
    next.file_owner_uid!=io->identity.file_owner_uid||next.receipt_sequence<=io->identity.receipt_sequence||
    (io->family&&(!io->client->root_store||memcmp(next.pool_id,io->client->root_store->identity.pool_id,32))))return store_failed(io,EPROTO);
 io->identity=next;io->claim.io=io;io->claim.identity=next;io->claim.valid=1;*out=&io->claim;return 1;
}
int nr_root_store_read_claim(nr_root_store_io *io,const nr_root_bootstrap_claim *claim,nr_root_store_identity *out){
 imported_store *remote=imported_io(io);if(remote){if(claim!=remote->claim)return 0;return remote->ops->read_claim(io,claim,out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!out||!store_association(io)||claim!=&io->claim||!io->claim.valid||io->claim.io!=io)return 0;
 *out=io->claim.identity;return 1;
}
int nr_root_store_bind_bootstrap(nr_root_store_io *io,enum nr_root_bind_mode mode,
 const nr_root_bootstrap_claim *claim,const nr_root_store_identity *verified){
 imported_store *remote=imported_io(io);if(remote){if(claim&&claim!=remote->claim)return 0;return remote->ops->bind_bootstrap(io,mode,claim,verified);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!verified||!store_association(io)||io->unknown||(mode!=NR_FRESH_COMMIT&&mode!=NR_RECOVER_COMMITTED)||
    !nr_io_identity_same(&io->identity,verified)||io->identity.birth_state<NR_CLAIMED||
    (mode==NR_FRESH_COMMIT&&(claim!=&io->claim||!io->claim.valid))||(mode==NR_RECOVER_COMMITTED&&claim))return 0;
 unsigned char body[164],bytes[NR_ROOT_IDENTITY_WIRE_BYTES];mi_frame reply={0};nr_root_store_identity next;
 nr_io_put32(body,(uint32_t)mode);memcpy(body+4,verified->namespace_id,32);memcpy(body+36,verified->pool_id,32);
 memcpy(body+68,verified->claim_id,32);memcpy(body+100,verified->anchor_digest,32);memcpy(body+132,verified->profile_digest,32);
 if(!store_request(io,MI_BIND_BOOTSTRAP,MI_SLOT_NONE,0,body,sizeof(body),0,&reply,bytes,sizeof(bytes))||reply.offset||reply.amount||
    !nr_io_identity_decode(bytes,reply.payload_length,&next)||next.birth_state!=NR_BOUND||!nr_io_identity_same(&io->identity,&next)||
    next.receipt_sequence<io->identity.receipt_sequence)return store_failed(io,EPROTO);
 io->identity=next;return 1;
}
static nr_root_store_file *new_store_file(nr_root_store_io *io,uint16_t slot,int readonly){
 nr_root_store_file *file=calloc(1,sizeof(*file));if(!file)return NULL;
 file->io=io;file->slot=slot;file->readonly=readonly;file->next=io->files;io->files=file;
 return file;
}
int nr_root_store_open_database(nr_root_store_io *io,nr_root_store_file **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->open_database(io,out);return ok&&retain_imported_file(remote,*out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 nr_root_store_identity identity;
 if(!out||!store_association(io)||io->client->close_requested||io->main_opened||!nr_root_store_read_identity(io,&identity)||identity.birth_state<NR_CLAIMED)return 0;
 nr_root_store_file *file=new_store_file(io,MI_DATABASE,0);if(!file)return store_failed(io,ENOMEM);
 io->main_opened=1;io->database=file;io->open_files++;*out=file;return 1;
}
static int journal_open(nr_root_store_io *io,int mode,int create,int *present,nr_root_store_file **out){
 if(!out||!present||!store_association(io)||io->client->close_requested||!io->database||io->database->closed||io->identity.birth_state<NR_CLAIMED)return 0;
 for(nr_root_store_file *f=io->files;f;f=f->next)if(f->slot==MI_JOURNAL&&!f->closed)return 0;
 nr_root_store_file *file=new_store_file(io,MI_JOURNAL,mode==NR_READONLY);if(!file)return store_failed(io,ENOMEM);
 unsigned char body[4],bytes[NR_ROOT_IDENTITY_WIRE_BYTES];nr_io_put32(body,(uint32_t)mode);mi_frame reply={0};nr_root_store_identity next;
 if(!store_request(io,create?MI_JOURNAL_CREATE:MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,create?NULL:body,create?0:4,0,&reply,bytes,sizeof(bytes))||
    reply.offset||reply.amount||!nr_io_identity_decode(bytes,reply.payload_length,&next)||!nr_io_identity_same(&io->identity,&next)||
    next.receipt_sequence<io->identity.receipt_sequence)return store_failed(io,EPROTO);
 io->identity=next;
 if(!next.journal_present){file->closed=1;io->journal_owner=NULL;*present=0;*out=NULL;return create?store_failed(io,EPROTO):1;}
 if(!nr_io_nonzero(next.journal_ticket)||!next.journal_generation)return store_failed(io,EPROTO);
 file->generation=next.journal_generation;memcpy(file->ticket,next.journal_ticket,32);io->journal_owner=file;io->open_files++;
 *present=1;*out=file;return 1;
}
int nr_root_store_open_journal(nr_root_store_io *io,enum nr_root_open_mode mode,int *present,nr_root_store_file **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->open_journal(io,mode,present,out);return ok&&retain_imported_file(remote,*out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(mode!=NR_READONLY&&mode!=NR_READWRITE)return 0;
 return journal_open(io,mode,0,present,out);
}
int nr_root_store_create_journal(nr_root_store_io *io,nr_root_store_file **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->create_journal(io,out);return ok&&retain_imported_file(remote,*out);}
 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 int present=0;return journal_open(io,NR_READWRITE,1,&present,out);}
static int file_ready(nr_root_store_file *file,int writing){
 return store_file(file)&&!file->closed&&(!writing||!file->readonly)&&
  (file->slot!=MI_JOURNAL||(file->io->journal_owner==file&&file->io->database&&!file->io->database->closed))&&store_alive(file->io,0);
}
static uint32_t file_body(nr_root_store_file *file,unsigned char *body){
 if(file->slot!=MI_JOURNAL)return 0;
 nr_io_put64(body,file->generation);memcpy(body+8,file->ticket,32);return 40;
}
int nr_root_store_read_at(nr_root_store_file *file,uint64_t offset,void *output,uint32_t amount,uint32_t *actual){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->read_at(file,offset,output,amount,actual);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!output||!actual||!file_ready(file,0)||!amount||amount>(file->io->family?MI_AUTHORITY_MAX_READ:MI_MAX_PAYLOAD)||offset>INT64_MAX-amount)return 0;
 unsigned char body[40];uint32_t length=file_body(file,body);mi_frame reply={0};
 if(!store_request(file->io,MI_READ,file->slot,offset,body,length,amount,&reply,output,amount)||reply.offset!=offset||reply.amount||reply.payload_length>amount)return store_failed(file->io,EPROTO);
 *actual=reply.payload_length;return 1;
}
int nr_root_store_write_at(nr_root_store_file *file,uint64_t offset,const void *input,uint32_t amount,uint32_t *actual){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->write_at(file,offset,input,amount,actual);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!input||!actual||!file_ready(file,1)||!amount||amount>(file->io->family?(file->slot==MI_JOURNAL?MI_AUTHORITY_MAX_JOURNAL_WRITE:MI_AUTHORITY_MAX_INNER):(file->slot==MI_JOURNAL?MI_MAX_PAYLOAD-40:MI_MAX_PAYLOAD))||offset>INT64_MAX-amount)return 0;
 unsigned char body[MI_MAX_PAYLOAD],unused[1];uint32_t length=file_body(file,body);memcpy(body+length,input,amount);mi_frame reply={0};
 if(!store_request(file->io,MI_WRITE,file->slot,offset,body,length+amount,amount,&reply,unused,0)||reply.offset!=offset||reply.payload_length||reply.amount!=amount)return store_failed(file->io,EPROTO);
 *actual=reply.amount;return 1;
}
int nr_root_store_size(nr_root_store_file *file,uint64_t *size){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->size(file,size);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!size||!file_ready(file,0))return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};uint32_t length=file_body(file,body);
 if(!store_request(file->io,MI_SIZE,file->slot,0,body,length,0,&reply,unused,0)||reply.payload_length||reply.amount||reply.offset>INT64_MAX)return store_failed(file->io,EPROTO);
 *size=reply.offset;return 1;
}
int nr_root_store_truncate(nr_root_store_file *file,uint64_t size){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->truncate(file,size);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!file_ready(file,1)||size>INT64_MAX)return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};uint32_t length=file_body(file,body);
 if(!store_request(file->io,MI_TRUNCATE,file->slot,size,body,length,0,&reply,unused,0)||reply.offset!=size||reply.payload_length||reply.amount)return store_failed(file->io,EPROTO);return 1;
}
int nr_root_store_sync(nr_root_store_file *file){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->sync(file);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!file_ready(file,0))return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};uint32_t length=file_body(file,body);
 if(!store_request(file->io,MI_SYNC,file->slot,0,body,length,0,&reply,unused,0)||reply.offset||reply.payload_length||reply.amount)return store_failed(file->io,EPROTO);return 1;
}
int nr_root_store_close_file(nr_root_store_file *file){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->close_file(file);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!store_file(file)||!store_association(file->io))return 0;if(file->closed)return !file->io->unknown;
 if(file->slot==MI_JOURNAL){
  unsigned char body[40],unused[1];mi_frame reply={0};file_body(file,body);
  if(!store_request(file->io,MI_JOURNAL_CLOSE,MI_JOURNAL,0,body,40,0,&reply,unused,0)||reply.offset||reply.amount||reply.payload_length)return store_failed(file->io,EPROTO);
 }
 file->closed=1;file->io->open_files--;return 1;
}
int nr_root_store_delete_journal(nr_root_store_io *io,uint64_t generation,const unsigned char ticket[32]){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->delete_journal(io,generation,ticket);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!ticket||!store_association(io))return 0;nr_root_store_file *original=NULL;
 for(nr_root_store_file *f=io->files;f;f=f->next)if(f->slot==MI_JOURNAL&&f->generation==generation&&!memcmp(f->ticket,ticket,32)){original=f;break;}
 if(!original||original!=io->journal_owner||!original->closed||!io->database||io->database->closed)return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};file_body(original,body);
 if(!store_request(io,MI_JOURNAL_DELETE,MI_JOURNAL,0,body,40,0,&reply,unused,0)||reply.offset||reply.amount||reply.payload_length)return store_failed(io,EPROTO);return 1;
}
int nr_root_store_directory_sync(nr_root_store_io *io){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->directory_sync(io);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!store_association(io))return 0;unsigned char unused[1];mi_frame reply={0};
 if(!store_request(io,MI_DIRECTORY_SYNC,MI_DATABASE,0,NULL,0,0,&reply,unused,0)||reply.offset||reply.amount||reply.payload_length)return store_failed(io,EPROTO);return 1;
}
enum nr_root_release_result nr_root_store_release_owned(nr_root_store_io *io){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->release_owned(io);}

 if(!store_member(io))return NR_UNKNOWN_HELD;
 NM_CLIENT_GUARD(io->client,NR_UNKNOWN_HELD);
 if(store_member(io)&&io->released&&io->pid==getpid()&&pthread_equal(io->thread,pthread_self()))return NR_SQL_FILES_CLOSED;
 if(!store_association(io)||io->unknown||io->client->fate.unknown)return NR_UNKNOWN_HELD;
 if(io->open_files)return NR_BUSY_HELD;
 if(io->family){unsigned char bytes[MI_AUTHORITY_RESULT_PREFIX];mi_frame reply={0},result={0};
  if(!authority_exchange(io,MI_AUTHORITY_RELEASE,io->authority_token,32,bytes,sizeof(bytes),&reply)||!authority_result(io,bytes,reply.payload_length,&result,NULL,0)||result.offset||result.amount||result.payload_length)return NR_UNKNOWN_HELD;
  if(!io->authority_hold||!io->client->authority_holds)return NR_UNKNOWN_HELD;
  io->authority_hold=0;io->client->authority_holds--;
 }
 io->released=1;return NR_SQL_FILES_CLOSED;
}

const nm_root_store_dispatch *nm_installed_root_store_dispatch(void){
 static const nm_root_store_dispatch ops={nr_root_store_read_identity,nr_root_store_claim_fresh,nr_root_store_read_claim,nr_root_store_bind_bootstrap,nr_root_store_open_database,nr_root_store_open_journal,nr_root_store_create_journal,nr_root_store_read_at,nr_root_store_write_at,nr_root_store_size,nr_root_store_truncate,nr_root_store_sync,nr_root_store_close_file,nr_root_store_delete_journal,nr_root_store_directory_sync,nr_root_store_release_owned};
 return &ops;
}

int nm_installed_root_store_close_ready(nm_installed_client *client,nr_root_store_io *io){
 NM_CLIENT_GUARD(client,-1);
 if(!original_member(client)||!store_member(io)||io->client!=client||client->root_store!=io||io->unknown||client->fate.unknown)return -1;
 if(client->authority_holds||client->worker_holds)return 0;
 return 1;
}

/* Fixed budget Worker leases. Records predate OPEN and remain tombstones.
 * Only the original CPP source supplies the actual Node thread identity. */
struct nm_budget_worker_lease {
 struct nm_budget_worker_lease *next;nm_installed_client *client;nr_root_store_io *io;
 pid_t pid;pthread_t owner,thread;uint64_t expected_id;_Atomic int state;int failed,joined;
};
static pthread_mutex_t worker_registry_mutex=PTHREAD_MUTEX_INITIALIZER;
static nm_budget_worker_lease *worker_leases;
static pid_t worker_registry_pid;
static nm_budget_worker_lease *budget_lease_member(nm_budget_worker_lease *candidate){
 if(!candidate||__atomic_load_n(&worker_registry_pid,__ATOMIC_ACQUIRE)!=getpid())return NULL;
 pthread_mutex_lock(&worker_registry_mutex);nm_budget_worker_lease *found=NULL;
 for(nm_budget_worker_lease *r=worker_leases;r;r=r->next)if(r==candidate){found=r;break;}
 pthread_mutex_unlock(&worker_registry_mutex);return found;
}
int nm_budget_worker_prepare(nm_installed_client *client,const unsigned char scope[32],nm_budget_worker_lease **out){
 NM_CLIENT_GUARD(client,0);
 if(!out||!scope||worker_client||!nm_installed_current(client))return 0;
 nm_budget_worker_lease *r=calloc(1,sizeof(*r));if(!r)return 0;
 r->client=client;r->pid=getpid();r->owner=pthread_self();atomic_init(&r->state,0);
 pthread_mutex_lock(&worker_registry_mutex);__atomic_store_n(&worker_registry_pid,getpid(),__ATOMIC_RELEASE);r->next=worker_leases;worker_leases=r;pthread_mutex_unlock(&worker_registry_mutex);
 client->worker_holds++;
 int known_denied=0;
 if(!borrow_authority_store(client,MI_FAMILY_BUDGET,scope,&r->io,&known_denied)){
  r->failed=1;
  /* Only the authenticated exact denial proves no family was opened. No
   * Worker constructor has entered. Unknown/late-no-handle keeps both holds. */
  if(known_denied){r->state=4;client->worker_holds--;}
  return 0;
 }
 *out=r;return 1;
}
int nm_installed_prepare_core_budget_worker(nm_installed_client *client,nm_budget_worker_lease **out){
 NM_CLIENT_GUARD(client,0);
 if(!out||!nm_installed_current(client)||client->core_budget_attempted||!client->root_store||client->root_store->identity.birth_state!=NR_BOUND)return 0;
 client->core_budget_attempted=1;
 unsigned char scope[32];
#ifdef MI_FIXTURE_BUILD
 memset(scope,0x22,sizeof(scope));
#else
 static const char domain[]="xiaok-original-core-budget-worker-v1";
 unsigned char input[sizeof(domain)+32];memcpy(input,domain,sizeof(domain));memcpy(input+sizeof(domain),client->root_store->identity.namespace_id,32);
 CC_SHA256(input,sizeof(input),scope);
#endif
 return nm_budget_worker_prepare(client,scope,out);
}
int nm_budget_worker_publish(nm_budget_worker_lease *candidate,uint64_t actual_id){
 nm_budget_worker_lease *r=budget_lease_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->owner,pthread_self())||!actual_id)return 0;
 NM_CLIENT_GUARD(r->client,0);if(r->state||r->failed)return 0;r->expected_id=actual_id;r->state=1;return 1;
}
int nm_budget_worker_bind_current(nm_budget_worker_lease *candidate,uint64_t actual_id,nr_root_store_io **out){
 nm_budget_worker_lease *r=budget_lease_member(candidate);if(!r||!out||r->pid!=getpid()||pthread_equal(r->owner,pthread_self())||r->state!=1||worker_client||worker_store)return 0;
 /* Registration is necessary but never enough: fixed CPP checks the original
  * Worker backing store and actual Environment id before calling this leaf. */
 worker_client=r->client;
 nm_client_guard guard __attribute__((cleanup(client_leave)))={r->client,client_enter(r->client)};
 if(!guard.held){worker_client=NULL;return 0;}
 if(r->failed||r->state!=1||actual_id!=r->expected_id||!nm_installed_current(r->client)){worker_client=NULL;return 0;}
 r->thread=pthread_self();r->io->thread=r->thread;r->state=2;worker_store=r->io;*out=r->io;return 1;
}
int nm_budget_worker_retire_current(nm_budget_worker_lease *candidate){
 nm_budget_worker_lease *r=budget_lease_member(candidate);
 if(!r||r->pid!=getpid()||r->state!=2||worker_client!=r->client||worker_store!=r->io||!pthread_equal(r->thread,pthread_self()))return 0;
 NM_CLIENT_GUARD(r->client,0);
 if(r->io->unknown||r->client->fate.unknown||!r->io->released||r->io->open_files)return 0;
 r->state=3;worker_store=NULL;worker_client=NULL;return 1;
}
int nm_budget_worker_bind_namespace_current(nm_budget_worker_lease *candidate){
 nm_budget_worker_lease *r=budget_lease_member(candidate);
 if(!r||r->pid!=getpid()||r->state!=2||worker_client!=r->client||worker_store!=r->io||!pthread_equal(r->thread,pthread_self()))return 0;
 NM_CLIENT_GUARD(r->client,0);nr_root_store_identity identity;
 if(!nr_root_store_read_identity(r->io,&identity))return 0;
 return nr_root_store_bind_bootstrap(r->io,r->io->claim.valid?NR_FRESH_COMMIT:NR_RECOVER_COMMITTED,r->io->claim.valid?&r->io->claim:NULL,&identity);
}
int nm_budget_worker_cleanup_environment_current(nm_budget_worker_lease *candidate){
 nm_budget_worker_lease *r=budget_lease_member(candidate);
 if(!r||r->pid!=getpid()||r->state!=3||worker_client||worker_store||!pthread_equal(r->thread,pthread_self()))return 0;
 worker_client=r->client;
 nm_client_guard guard __attribute__((cleanup(client_leave)))={r->client,client_enter(r->client)};
 if(!guard.held){worker_client=NULL;return 0;}
 if(r->io->unknown||r->client->fate.unknown||!r->io->released||r->io->open_files||!r->client->worker_holds){worker_client=NULL;return 0;}
 r->state=4;r->client->worker_holds--;worker_client=NULL;return 1;
}
const nm_budget_worker_dispatch *nm_original_budget_worker_dispatch(void){
 static nm_budget_worker_dispatch ops;
 /* Same original DSO; immutable initialization before any Worker is published. */
 if(!ops.io){ops.publish=nm_budget_worker_publish;ops.bind_current=nm_budget_worker_bind_current;ops.bind_namespace_current=nm_budget_worker_bind_namespace_current;ops.retire_current=nm_budget_worker_retire_current;ops.cleanup_environment_current=nm_budget_worker_cleanup_environment_current;ops.io=nm_installed_root_store_dispatch();}
 return &ops;
}
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
int nm_fixture_budget_worker_join_owned(nm_budget_worker_lease *candidate){
 nm_budget_worker_lease *r=budget_lease_member(candidate);
 if(!r||r->pid!=getpid()||!pthread_equal(r->owner,pthread_self())||r->failed)return 0;
 if(r->state==4)return r->joined;
 uint64_t deadline=mi_now_ms()+500;
 pthread_t actual;int ready=0;
 while(mi_now_ms()<deadline){
  {NM_CLIENT_GUARD(r->client,0);if(r->state>=2){actual=r->thread;ready=1;}}
  if(ready)break;struct timespec pause={0,1000000};nanosleep(&pause,NULL);
 }
 if(!ready)return 0;
 /* Native captured pthread is joined here, not a caller-supplied known flag. */
 if(pthread_join(actual,NULL))return 0;
 NM_CLIENT_GUARD(r->client,0);
 if(r->state!=3||!r->io->released||r->io->unknown||r->client->fate.unknown||!r->client->worker_holds)return 0;
 r->joined=1;r->state=4;r->client->worker_holds--;return 1;
}
#endif

int nm_installed_prepare_core_admission_store(nm_installed_client *client,nr_root_store_io **out){
 NM_CLIENT_GUARD(client,0);
 if(!out||!nm_installed_current(client)||client->core_admission_attempted||!client->root_store||client->root_store->identity.birth_state!=NR_BOUND)return 0;
 client->core_admission_attempted=1;unsigned char scope[32];
#ifdef MI_FIXTURE_BUILD
 memset(scope,0x11,sizeof(scope));
#else
 static const char domain[]="xiaok-original-core-admission-v1";unsigned char input[sizeof(domain)+32];memcpy(input,domain,sizeof(domain));memcpy(input+sizeof(domain),client->root_store->identity.namespace_id,32);CC_SHA256(input,sizeof(input),scope);
#endif
 if(!borrow_authority_store(client,MI_FAMILY_ADMISSION,scope,out,NULL))return 0;
 nr_root_store_identity identity;const nr_root_bootstrap_claim *claim=NULL;
 if(!nr_root_store_read_identity(*out,&identity))return 0;
 if(identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(*out,&claim)||!nr_root_store_read_claim(*out,claim,&identity)))return 0;
 return 1;
}
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
int nm_fixture_close_core_budget_owner(nm_installed_client *client){
 NM_CLIENT_GUARD(client,0);
 if(!client->root_store||nm_installed_root_store_close_ready(client,client->root_store)!=1||nr_root_store_release_owned(client->root_store)!=NR_SQL_FILES_CLOSED)return 0;
 return nm_installed_close_owned(client);
}
#endif
