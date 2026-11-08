#ifndef XIAOK_ORIGINAL_BROKER_CHILD_LAUNCH_H
#define XIAOK_ORIGINAL_BROKER_CHILD_LAUNCH_H
#include "broker-protocol.h"
#include "../root-resource-authority/installed-main-client.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct nm_broker_child_birth nm_broker_child_birth;
/* Fixed original Core producer, not a generic family/scope/path opener. */
int nm_installed_prepare_core_broker_child(nm_installed_client *,nm_broker_child_birth **);
/* Only an original not-entered preparation can be cancelled. Negative cleanup
 * never revalidates a revoked positive Source or accepts a known flag. */
int nm_broker_child_cancel_unlaunched(nm_broker_child_birth *);
/* Native-only fixed executable. No caller executable, argv, seed or family. */
int nm_broker_child_launch(nm_broker_child_birth *);
int nm_broker_child_wait_owned(nm_broker_child_birth *);
/* Original process observation: 0 pending, 1 actual waitpid, -1 unknown. */
int nm_broker_child_poll_owned(nm_broker_child_birth *);
/* Fixed business streams (1 stdout, 2 stderr, 3 IPC), never a raw descriptor.
 * 1 bytes / 0 actual EOF+close / 2 would-block / -1 unknown. */
int nm_broker_child_read_stream(nm_broker_child_birth *,int,void *,uint32_t,uint32_t *);
int nm_broker_child_write_business(nm_broker_child_birth *,const void *,uint32_t,uint32_t *);
int nm_broker_child_signal_owned(nm_broker_child_birth *,int);
int nm_broker_child_assert_terminal(nm_broker_child_birth *);
int nm_broker_child_read_fate(nm_broker_child_birth *,int *actual_pid,int *wait_status,int *known);
typedef struct nm_broker_child_dispatch {
 int (*launch)(nm_broker_child_birth *);
 int (*cancel_unlaunched)(nm_broker_child_birth *);
 int (*wait_owned)(nm_broker_child_birth *);
 int (*poll_owned)(nm_broker_child_birth *);
 int (*read_stream)(nm_broker_child_birth *,int,void *,uint32_t,uint32_t *);
 int (*write_business)(nm_broker_child_birth *,const void *,uint32_t,uint32_t *);
 int (*signal_owned)(nm_broker_child_birth *,int);
 int (*assert_terminal)(nm_broker_child_birth *);
 int (*read_fate)(nm_broker_child_birth *,int *,int *,int *);
} nm_broker_child_dispatch;
const nm_broker_child_dispatch *nm_original_broker_child_dispatch(void);
/* Called only by the fixed child Native bootstrap, before loading KS modules. */
int nm_installed_connect_broker_child(nm_installed_client *,nr_root_store_io **);
int nm_broker_child_bind_namespace_current(nm_installed_client *);
#ifdef __cplusplus
}
#endif
#endif
