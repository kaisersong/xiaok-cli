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
#include <sys/socket.h>
#include <sys/wait.h>
#include <spawn.h>
#include <signal.h>
#include <pthread.h>
#include <time.h>
#include <stdatomic.h>
#include <CommonCrypto/CommonDigest.h>
#include "installed-budget-worker-io.h"
#include "../kswarm-authority-source/kswarm-child-launch.h"
#include "root-store-io-codec.h"
#include "root-store-io-dispatch.h"
#include "installed-main-core-private.h"
#include "installed-main-store-association-private.h"
#include "installed-main-store-files-private.h"
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

struct nm_kswarm_child_birth {
 struct nm_kswarm_child_birth *next;nm_installed_client *client;nr_root_store_io *io;
 pid_t pid,child;pthread_t thread;int entered,cancelled,unknown,prepared,spawn_entered,launched,waited,wait_status,wait_lost,retired,ipc,stdout_fd,stderr_fd;int failed_fds[8],failed_fd_count;
};
static _Thread_local nm_kswarm_child_birth *kswarm_births;
static void ks_forget_client(nm_installed_client *client){for(nm_kswarm_child_birth *r=kswarm_births;r;r=r->next)if(r->client==client)r->client=NULL;}
static nm_kswarm_child_birth *kswarm_birth_member(nm_kswarm_child_birth *candidate){
 for(nm_kswarm_child_birth *r=kswarm_births;r;r=r->next)if(r==candidate)return r;
 return NULL;
}
int nm_installed_prepare_core_kswarm_child(nm_installed_client *client,nm_kswarm_child_birth **out){
 NM_CLIENT_GUARD(client,0);
 if(!out||!nm_installed_current(client)||client->core_kswarm_attempted||!client->root_store||client->root_store->identity.birth_state!=NR_BOUND)return 0;
 client->core_kswarm_attempted=1;
 nm_kswarm_child_birth *birth=calloc(1,sizeof(*birth));if(!birth){unknown(client,ENOMEM);return 0;}
 birth->client=client;birth->ipc=birth->stdout_fd=birth->stderr_fd=-1;birth->pid=getpid();birth->thread=pthread_self();birth->next=kswarm_births;kswarm_births=birth;
 unsigned char scope[32];
#ifdef MI_FIXTURE_BUILD
 /* Bounded component realm only; still the fixed KS family, never JS input. */
 memset(scope,0x11,sizeof(scope));
#else
 static const char domain[]="xiaok-original-core-kswarm-state-v1";
 unsigned char input[sizeof(domain)+32];memcpy(input,domain,sizeof(domain));memcpy(input+sizeof(domain),client->root_store->identity.namespace_id,32);CC_SHA256(input,sizeof(input),scope);mi_zero(input,sizeof(input));
#endif
 int denied=0;
 if(!borrow_authority_store(client,MI_FAMILY_KSWARM,scope,&birth->io,&denied)){birth->unknown=!denied;return 0;}
 *out=birth;return 1;
}
int nm_kswarm_child_cancel_unlaunched(nm_kswarm_child_birth *candidate){
 nm_kswarm_child_birth *birth=kswarm_birth_member(candidate);
 if(!birth||birth->pid!=getpid()||!pthread_equal(birth->thread,pthread_self())||birth->entered||birth->unknown)return 0;
 NM_CLIENT_GUARD(birth->client,0);
 if(birth->cancelled)return 1;
 if(!birth->io||nr_root_store_release_owned(birth->io)!=NR_SQL_FILES_CLOSED){birth->unknown=1;return 0;}
 birth->cancelled=1;return 1;
}

#include "../kswarm-authority-source/kswarm-client-private.h"
#include "../kswarm-authority-source/kswarm-child-client-private.h"

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
