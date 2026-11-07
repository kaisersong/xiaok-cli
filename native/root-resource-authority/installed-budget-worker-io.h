#ifndef XIAOK_ORIGINAL_INSTALLED_BUDGET_WORKER_IO_H
#define XIAOK_ORIGINAL_INSTALLED_BUDGET_WORKER_IO_H
#include "installed-main-client.h"
#include "root-store-io-dispatch.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Fixed Native source only. No JS pointer, path, family selector or verifier. */
typedef struct nm_budget_worker_lease nm_budget_worker_lease;
int nm_budget_worker_prepare(nm_installed_client *,const unsigned char[32],nm_budget_worker_lease **);
int nm_budget_worker_publish(nm_budget_worker_lease *,uint64_t);
int nm_budget_worker_bind_current(nm_budget_worker_lease *,uint64_t,nr_root_store_io **);
int nm_budget_worker_retire_current(nm_budget_worker_lease *);
/* Fixed original addon Environment cleanup hook only. It proves the sealed IO
 * borrower ended, not the Worker process/OS domain or a resource refund. */
int nm_budget_worker_cleanup_environment_current(nm_budget_worker_lease *);
int nm_installed_prepare_core_admission_store(nm_installed_client *,nr_root_store_io **);
int nm_installed_prepare_core_budget_worker(nm_installed_client *,nm_budget_worker_lease **);
int nm_budget_worker_bind_namespace_current(nm_budget_worker_lease *);
typedef struct nm_budget_worker_dispatch {
 int (*publish)(nm_budget_worker_lease *,uint64_t);
 int (*bind_current)(nm_budget_worker_lease *,uint64_t,nr_root_store_io **);
 int (*bind_namespace_current)(nm_budget_worker_lease *);
 int (*retire_current)(nm_budget_worker_lease *);
 int (*cleanup_environment_current)(nm_budget_worker_lease *);
 const nm_root_store_dispatch *io;
} nm_budget_worker_dispatch;
const nm_budget_worker_dispatch *nm_original_budget_worker_dispatch(void);
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
int nm_fixture_close_core_budget_owner(nm_installed_client *);
/* Actual pthread_join of the thread captured by bind, never caller known. */
int nm_fixture_budget_worker_join_owned(nm_budget_worker_lease *);
#endif
#ifdef __cplusplus
}
#endif
#endif
