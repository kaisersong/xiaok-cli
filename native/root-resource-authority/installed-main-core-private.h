/* Same original translation unit, exact contiguous function group. Not a public header. */
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
 int close_requested,core_budget_attempted,core_admission_attempted,core_kswarm_attempted,core_broker_attempted,ks_role;
 unsigned char ks_pool[32];
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
 nr_root_store_io *io;nr_root_store_identity identity;nr_original_pool_history history;int valid,kind;
};
struct nr_root_store_io {
 struct nr_root_store_io *next;nm_installed_client *client;
 pid_t pid;pthread_t thread;int released,unknown,main_opened,open_files;
 uint32_t family;unsigned char authority_token[32],scope[32];int authority_hold;
 nr_root_store_identity identity;nr_root_store_file *files;
 nr_root_store_file *database,*journal_owner;
 struct nr_root_bootstrap_claim claim;int adoption_checked;enum nr_root_adoption_kind adoption_kind;nr_original_pool_history adoption_history;
};
static _Thread_local nr_root_store_io *root_stores;
static _Thread_local nr_root_store_io *worker_store;
static _Thread_local nm_installed_client *worker_client;
static int root_store_held(nr_root_store_io *io){return io&&!io->released;}
static _Thread_local nm_installed_client *clients;
static void ks_forget_client(nm_installed_client *);
static void br_forget_client(nm_installed_client *);
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
 mi_frame request={0},reply={0};request.domain=(uint8_t)(p->ks_role==2?MI_BROKER_IO:p->ks_role?MI_KSWARM_IO:i+1);request.operation=(uint16_t)operation;request.sequence=c->next_sequence;memcpy(request.nonce,p->birth.nonce,32);
 unsigned char payload[MI_MAX_PAYLOAD];uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 int good=mi_wire_send(c->fd,c->key,&request,NULL,deadline)&&mi_wire_receive(c->fd,c->key,&reply,payload,sizeof(payload),deadline)&&response_matches(p,&reply,p->ks_role==2?MI_BROKER_IO:p->ks_role?MI_KSWARM_IO:i+1,operation,c->next_sequence);mi_zero(payload,sizeof(payload));
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
int nm_installed_current(nm_installed_client *p){NM_CLIENT_GUARD(p,0);return original_member(p)&&!p->close_requested&&p->fate.connected&&!p->fate.closed&&!p->fate.unknown&&!p->channels[0].close_attempted&&(p->ks_role||!p->channels[1].close_attempted)&&channel_peer(p,p->channels)&&(p->ks_role||channel_peer(p,p->channels+1));}
int nm_installed_ping(nm_installed_client *p){
 NM_CLIENT_GUARD(p,0);
 if(!nm_installed_current(p))return 0;
 for(int i=0;i<(p->ks_role?1:2);i++)if(!exchange(p,i,MI_PING))return 0;return 1;
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
 if(!p->ks_role&&p->channels[0].remote_closed&&p->channels[0].local_closed&&!p->fate.unknown)p->fate.root_files_closed=1;
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
 ks_forget_client(p);br_forget_client(p);client_leave(&nm_guard);pthread_mutex_destroy(&p->io_mutex);mi_zero(p,sizeof(*p));free(p);
}
