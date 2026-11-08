/* Original client TU only: fixed Broker family; no caller role/scope. */
struct nm_broker_child_birth {
 struct nm_broker_child_birth *next;nm_installed_client *client;nr_root_store_io *io;
 pid_t pid,child;pthread_t thread;int entered,cancelled,unknown,prepared,spawn_entered,launched,waited,wait_status,wait_lost,retired,ipc,stdout_fd,stderr_fd;int failed_fds[8],failed_fd_count;
};
static _Thread_local nm_broker_child_birth *broker_births;
static void br_forget_client(nm_installed_client *client){for(nm_broker_child_birth *r=broker_births;r;r=r->next)if(r->client==client)r->client=NULL;}
static nm_broker_child_birth *broker_birth_member(nm_broker_child_birth *candidate){
 for(nm_broker_child_birth *r=broker_births;r;r=r->next)if(r==candidate)return r;
 return NULL;
}
int nm_installed_prepare_core_broker_child(nm_installed_client *client,nm_broker_child_birth **out){
 NM_CLIENT_GUARD(client,0);
 if(!out||!nm_installed_current(client)||client->core_broker_attempted||!client->root_store||client->root_store->identity.birth_state!=NR_BOUND)return 0;
 if(!ps_sqlite_api_available())return 0;
 client->core_broker_attempted=1;
 nm_broker_child_birth *birth=calloc(1,sizeof(*birth));if(!birth){unknown(client,ENOMEM);return 0;}
 birth->client=client;birth->ipc=birth->stdout_fd=birth->stderr_fd=-1;birth->pid=getpid();birth->thread=pthread_self();birth->next=broker_births;broker_births=birth;
 unsigned char scope[32];
#ifdef MI_FIXTURE_BUILD
 /* Bounded component realm only; still the fixed Broker family, never JS input. */
 memset(scope,0x11,sizeof(scope));
#else
 static const char domain[]="xiaok-original-core-broker-state-v1";
 unsigned char input[sizeof(domain)+32];memcpy(input,domain,sizeof(domain));memcpy(input+sizeof(domain),client->root_store->identity.namespace_id,32);CC_SHA256(input,sizeof(input),scope);mi_zero(input,sizeof(input));
#endif
 int denied=0;
 if(!borrow_authority_store(client,MI_FAMILY_BROKER,scope,&birth->io,&denied)){birth->unknown=!denied;return 0;}
 *out=birth;return 1;
}
int nm_broker_child_cancel_unlaunched(nm_broker_child_birth *candidate){
 nm_broker_child_birth *birth=broker_birth_member(candidate);
 if(!birth||birth->pid!=getpid()||!pthread_equal(birth->thread,pthread_self())||birth->entered||birth->unknown)return 0;
 NM_CLIENT_GUARD(birth->client,0);
 if(birth->cancelled)return 1;
 if(!birth->io||nr_root_store_release_owned(birth->io)!=NR_SQL_FILES_CLOSED){birth->unknown=1;return 0;}
 birth->cancelled=1;return 1;
}

#include "broker-client-private.h"
#include "broker-child-client-private.h"
