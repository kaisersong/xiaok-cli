#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sqlite3.h>
#include "installed-main-client.h"
#include "original-root-io-vfs.h"
#include "../../../native/kswarm-authority-source/kswarm-child-launch.h"
#if !defined(MI_FIXTURE_BUILD) || !defined(NR_ROOT_IO_COMPONENT)
#error "Fixed component realm only"
#endif
int main(void){
 nm_installed_client *client=nm_installed_create();nr_root_store_io *io=NULL,*other=NULL;
 const nr_root_bootstrap_claim *claim=NULL;nr_root_store_identity identity;
 nr_original_root_vfs *vfs=NULL;sqlite3 *db=NULL;nm_installed_fate before={0},after={0};int failure=0;
 if(!client||!nm_installed_connect_kswarm_child(client,&io)||!io||!nm_installed_current(client)){failure=1;goto cleanup;}
 if(!nm_installed_fate_read(client,&before)||nm_installed_borrow_root_store(client,&other)||other||!nm_installed_fate_read(client,&after)||before.root_sequence!=after.root_sequence){failure=2;goto cleanup;}
 if(!nr_root_store_read_identity(io,&identity)){failure=3;goto cleanup;}
 if(identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity))){failure=4;goto cleanup;}
 if(nr_original_root_vfs_create(io,&vfs)!=SQLITE_OK||nr_original_root_vfs_open(vfs,&db)!=SQLITE_OK){failure=5;goto cleanup;}
 if(sqlite3_exec(db,"CREATE TABLE component_ks_evidence(body TEXT NOT NULL);INSERT INTO component_ks_evidence VALUES('original-child');",NULL,NULL,NULL)!=SQLITE_OK){failure=6;goto cleanup;}
 if(!nr_root_store_read_identity(io,&identity)||!nr_root_store_bind_bootstrap(io,claim?NR_FRESH_COMMIT:NR_RECOVER_COMMITTED,claim,&identity)){failure=7;goto cleanup;}
 if(write(3,"KS",2)!=2){failure=8;goto cleanup;}
cleanup:
 if(vfs&&db&&nr_original_root_vfs_close(vfs,&db)!=NR_SQL_FILES_CLOSED&&!failure)failure=9;
 if(io&&nr_root_store_release_owned(io)!=NR_SQL_FILES_CLOSED&&!failure)failure=10;
 if(client&&!nm_installed_close_owned(client)&&!failure)failure=11;
 printf("{\"kind\":\"ks-fixed-delegated-child\",\"pid\":%ld,\"failure\":%d,\"rootDeniedZeroIo\":%s,\"businessFd3\":%s,\"productionQualified\":false}\n",(long)getpid(),failure,failure==2?"false":"true",failure==8?"false":"true");
 nm_installed_release(client);return failure?1:0;
}
