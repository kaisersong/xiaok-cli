/* Component only: original helper/client plus actual pthread, no Main grant. */
#include <pthread.h>
#include <stdio.h>
#include <sys/stat.h>
#include <string.h>
#include <sqlite3.h>
#include <stdatomic.h>
#include <time.h>
#include "../../../native/main-installation/wire.h"
#include "installed-main-client.h"
#include "installed-budget-worker-io.h"
#include "original-root-io-vfs.h"
#if !defined(MI_FIXTURE_BUILD) || !defined(NR_ROOT_IO_COMPONENT)
#error component only
#endif
int nr_component_borrow_original_root_store(nm_installed_client *,nr_root_store_io **);
typedef struct task {nm_budget_worker_lease *lease;nr_root_store_io *original;int rejected,opened,closed,error;_Atomic int ready,start;} task;
static void *run(void *raw){task *t=raw;nr_root_store_identity identity;nr_root_store_io *io=NULL;const nr_root_bootstrap_claim *claim=NULL;nr_original_root_vfs *vfs=NULL;sqlite3 *db=NULL;
 t->rejected=!nr_root_store_read_identity(t->original,&identity);
 if(!nm_budget_worker_bind_current(t->lease,1,&io)||!nr_root_store_read_identity(io,&identity)){t->error=1;return NULL;}
 if(identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity))){t->error=2;return NULL;}
 if(nr_original_root_vfs_create(io,&vfs)!=SQLITE_OK||nr_original_root_vfs_open(vfs,&db)!=SQLITE_OK){t->error=3;return NULL;}
 t->opened=1;atomic_store(&t->ready,1);while(!atomic_load(&t->start)){struct timespec pause={0,1000000};nanosleep(&pause,NULL);}
 if(sqlite3_exec(db,"BEGIN IMMEDIATE;CREATE TABLE budget_component(id INTEGER PRIMARY KEY,spent INTEGER NOT NULL);INSERT INTO budget_component VALUES(1,7);COMMIT;",NULL,NULL,NULL)!=SQLITE_OK){t->error=4;return NULL;}
 for(int n=0;n<64;n++)if(sqlite3_exec(db,"BEGIN IMMEDIATE;UPDATE budget_component SET spent=spent+1 WHERE id=1;COMMIT;",NULL,NULL,NULL)!=SQLITE_OK){t->error=7;return NULL;}
 if(nr_original_root_vfs_close(vfs,&db)!=NR_SQL_FILES_CLOSED){t->error=5;return NULL;}t->closed=1;
 if(!nm_budget_worker_retire_current(t->lease)){t->error=6;return NULL;}return NULL;
}
int main(void){char mode[32]={0};if(fgets(mode,sizeof(mode),stdin))mode[strcspn(mode,"\n")]=0;int denied=!strcmp(mode,"known-denied"),uncertain=!strcmp(mode,"unknown-open");nm_installed_client *client=nm_installed_create();nr_root_store_io *root=NULL;nr_root_store_identity identity;const nr_root_bootstrap_claim *claim=NULL;nm_budget_worker_lease *lease=NULL;unsigned char scope[32];memset(scope,denied?0x33:0x22,32);int failure=0;task t={0};pthread_t worker;int entered=0,joined=0,busy=0,concurrent=0;nm_installed_fate fate={0};
 if(!client||!nm_installed_connect(client)||!nr_component_borrow_original_root_store(client,&root)||!nr_root_store_read_identity(root,&identity)){failure=10;goto done;}
 if(!nr_root_store_claim_fresh(root,&claim)||!nr_root_store_read_claim(root,claim,&identity)||!nr_root_store_bind_bootstrap(root,NR_FRESH_COMMIT,claim,&identity)){failure=11;goto done;}
 if(uncertain){if(mkdir(MI_FIXED_ROOT "/authority-families",0700)||chmod(MI_FIXED_ROOT "/authority-families",0755)){failure=23;goto done;}if(nm_budget_worker_prepare(client,scope,&lease)||lease||nm_installed_root_store_close_ready(client,root)!=-1){failure=24;goto done;}goto done;}
 if(denied){if(nm_budget_worker_prepare(client,scope,&lease)||lease||nm_installed_root_store_close_ready(client,root)!=1){failure=21;goto done;}if(nr_root_store_release_owned(root)!=NR_SQL_FILES_CLOSED){failure=22;goto done;}goto done;}
 if(!nm_budget_worker_prepare(client,scope,&lease)||!nm_budget_worker_publish(lease,1)){failure=12;goto done;}
 busy=nm_installed_root_store_close_ready(client,root)==0;t.lease=lease;t.original=root;
 if(pthread_create(&worker,NULL,run,&t)){failure=13;goto done;}entered=1;
 uint64_t deadline=mi_now_ms()+5000;while(!atomic_load(&t.ready)&&mi_now_ms()<deadline){struct timespec pause={0,1000000};nanosleep(&pause,NULL);}atomic_store(&t.start,1);
 if(!atomic_load(&t.ready)){failure=19;goto done;}
 for(int n=0;n<64;n++)if(!nr_root_store_read_identity(root,&identity)){failure=20;goto done;}concurrent=1;
 if(!nm_fixture_budget_worker_join_owned(lease)){failure=14;goto done;}joined=1;
 if(t.error||!t.rejected||!t.opened||!t.closed||!nm_fixture_budget_worker_join_owned(lease)){failure=15;goto done;}
 if(nm_installed_root_store_close_ready(client,root)!=1){failure=16;goto done;}
 if(nr_root_store_release_owned(root)!=NR_SQL_FILES_CLOSED){failure=17;goto done;}
 done: if(entered&&!joined){atomic_store(&t.start,1);pthread_join(worker,NULL);joined=1;}if(!nm_installed_close_owned(client)&&!failure&&!uncertain)failure=18;nm_installed_fate_read(client,&fate);
 printf("{\"kind\":\"original-budget-worker-io-component\",\"failure\":%d,\"threadFailure\":%d,\"knownDeniedNoWorker\":%s,\"unknownOpenNoWorker\":%s,\"concurrentMainFrames\":%s,\"crossThreadOriginalRejected\":%s,\"busyBeforeWorker\":%s,\"workerSqlClosed\":%s,\"joined\":%s,\"unknown\":%s,\"rootFilesClosed\":%s,\"productionQualified\":false}\n",failure,t.error,denied?"true":"false",uncertain?"true":"false",concurrent?"true":"false",t.rejected?"true":"false",busy?"true":"false",t.closed?"true":"false",joined?"true":"false",fate.unknown?"true":"false",fate.root_files_closed?"true":"false");return failure?1:0;}
