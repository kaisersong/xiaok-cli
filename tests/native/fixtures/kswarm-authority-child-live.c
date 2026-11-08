#define _DARWIN_C_SOURCE
#include <stdio.h>
#include <unistd.h>
#include "../../../native/main-installation/wire.h"
#include "installed-main-client.h"
#include "../../../native/kswarm-authority-source/kswarm-child-launch.h"
#if !defined(MI_FIXTURE_BUILD) || !defined(NR_ROOT_IO_COMPONENT)
#error "Fixed component realm only"
#endif
int main(void){
 nm_installed_client *client=nm_installed_create();nr_root_store_io *io=NULL;
 const nr_root_bootstrap_claim *claim=NULL;nr_root_store_identity identity;
 nm_kswarm_child_birth *birth=NULL,*duplicate=NULL;nm_installed_fate before={0},after={0},fate={0};
 int failure=0,once=0,held=0,cancelled=0;
 if(!client||!nm_installed_connect(client)||!nr_component_borrow_original_root_store(client,&io)||!nr_root_store_read_identity(io,&identity)){failure=1;goto cleanup;}
 if(identity.birth_state==NR_CREATED){if(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity)||!nr_root_store_bind_bootstrap(io,NR_FRESH_COMMIT,claim,&identity)){failure=2;goto cleanup;}}
 else if(identity.birth_state!=NR_BOUND){failure=2;goto cleanup;}
 char pool[65]={0};for(int index=0;index<32;index++)snprintf(pool+2*index,3,"%02x",identity.pool_id[index]);
 printf("{\"kind\":\"ks-native-original-pool\",\"poolId\":\"%s\",\"fresh\":%s}\n",pool,claim?"true":"false");
 if(!nm_installed_prepare_core_kswarm_child(client,&birth)||!birth){failure=3;goto cleanup;}
 if(!nm_installed_fate_read(client,&before)){failure=4;goto cleanup;}
 once=!nm_installed_prepare_core_kswarm_child(client,&duplicate)&&!duplicate&&nm_installed_fate_read(client,&after)&&before.root_sequence==after.root_sequence;
 if(!once){failure=5;goto cleanup;}
 #ifdef MI_FIXTURE_KSWARM_RUN_CHILD
 if(!nm_kswarm_child_launch(birth)){failure=11;goto cleanup;}
 held=!nm_installed_close_owned(client);if(!held){failure=6;goto cleanup;}
 unsigned char bytes[4096];int done=0;uint64_t deadline=mi_now_ms()+15000;
 while(!done&&mi_now_ms()<deadline){
  int exited=nm_kswarm_child_poll_owned(birth),closed=0;if(exited<0){failure=14;goto cleanup;}
  for(int stream=1;stream<=3;stream++)for(;;){uint32_t count=0;int code=nm_kswarm_child_read_stream(birth,stream,bytes,sizeof(bytes),&count);if(code<0){failure=15;goto cleanup;}if(code==0){closed++;break;}if(code==2)break;if(stream<=2&&write(stream,bytes,count)!=(ssize_t)count){failure=16;goto cleanup;}}
  if(exited&&closed==3)done=1;else usleep(1000);
 }
 if(!done){failure=17;goto cleanup;}
 cancelled=nm_kswarm_child_wait_owned(birth);if(!cancelled){failure=12;goto cleanup;}
 int actual_pid=0,wait_status=0,physical_known=0;
 if(!nm_kswarm_child_read_fate(birth,&actual_pid,&wait_status,&physical_known)||!physical_known||wait_status){failure=13;goto cleanup;}
 printf("{\"kind\":\"ks-native-original-wait\",\"pid\":%d,\"status\":%d,\"known\":true}\n",actual_pid,wait_status);
#else
 held=!nm_installed_close_owned(client);if(!held){failure=6;goto cleanup;}
 cancelled=nm_kswarm_child_cancel_unlaunched(birth)&&nm_kswarm_child_cancel_unlaunched(birth);
 if(!cancelled){failure=7;goto cleanup;}
#endif
cleanup:
 if(io&&nr_root_store_release_owned(io)!=NR_SQL_FILES_CLOSED&&!failure)failure=8;
 if(client&&!nm_installed_close_owned(client)&&!failure)failure=9;
 if(client&&!nm_installed_fate_read(client,&fate)&&!failure)failure=10;
 printf("{\"kind\":\"ks-fixed-native-core-component\",\"failure\":%d,\"onceZeroIo\":%s,\"coreCloseHeld\":%s,\"negativeCleanupKnown\":%s,\"rootFilesClosed\":%s,\"unknown\":%s,\"productionQualified\":false}\n",failure,once?"true":"false",held?"true":"false",cancelled?"true":"false",fate.root_files_closed?"true":"false",fate.unknown?"true":"false");
 nm_installed_release(client);return failure?1:0;
}
