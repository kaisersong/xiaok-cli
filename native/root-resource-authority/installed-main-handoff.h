#ifndef XIAOK_ORIGINAL_INSTALLED_MAIN_HANDOFF_H
#define XIAOK_ORIGINAL_INSTALLED_MAIN_HANDOFF_H
#include <stdint.h>
#include "installed-main-client.h"
#include "root-store-io-dispatch.h"
#include "installed-budget-worker-io.h"
/* This table is held only in an original issuer's V8 Private capsule. It is
 * neither an N-API argument nor a caller callback/registration interface.
 * Every entry first checks the producing DSO's private capsule membership. */
#define NM_HANDOFF_VERSION 4u
#define NM_HANDOFF_MAGIC UINT64_C(0x584b4d48414e4434)
#define NM_HANDOFF_PRIVATE "xiaok.original.native.main.installation.handoff.v4"
typedef struct nm_installation_handoff nm_installation_handoff;
struct nm_installation_handoff {
 uint64_t magic;uint32_t version,size,build_kind;
 int (*borrow)(const nm_installation_handoff *,const void *original_issuer_local,const void *destination_environment,const void *destination_bridge,const void *destination_cookie);
 int (*current)(const nm_installation_handoff *);
 int (*ping)(const nm_installation_handoff *);
 int (*close_owned)(const nm_installation_handoff *);
 int (*fate)(const nm_installation_handoff *,nm_installed_fate *);
 int (*borrow_root_store)(const nm_installation_handoff *,const void *destination_environment,const void *destination_bridge,const void *destination_cookie,nr_root_store_io **);
 const nm_root_store_dispatch *root_store_ops;
 int (*root_store_close_ready)(const nm_installation_handoff *,nr_root_store_io *);
 int (*prepare_budget_worker)(const nm_installation_handoff *,const void *,const void *,nm_budget_worker_lease **);
 const nm_budget_worker_dispatch *budget_worker_ops;
 int (*prepare_admission_store)(const nm_installation_handoff *,const void *,const void *,nr_root_store_io **);
 void (*release)(const nm_installation_handoff *,const void *destination_bridge,const void *destination_cookie);
};
#endif
