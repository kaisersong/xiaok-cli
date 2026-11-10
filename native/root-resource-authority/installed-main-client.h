#ifndef XIAOK_ORIGINAL_INSTALLED_MAIN_CLIENT_H
#define XIAOK_ORIGINAL_INSTALLED_MAIN_CLIENT_H
#include <stdint.h>
#include "root-store-io.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct nm_installed_client nm_installed_client;
typedef struct nm_installed_fate {
 int attempted,entered,connected,closed,unknown,seed_closed,root_files_closed;
 int error_present,error_code;
 uint64_t root_sequence,dispatch_sequence;
} nm_installed_fate;
/* Native internal. There is no JS path/FD/key/rawsend argument. */
nm_installed_client *nm_installed_create(void);
int nm_installed_connect(nm_installed_client *);
int nm_installed_current(nm_installed_client *);
int nm_installed_ping(nm_installed_client *);
int nm_installed_close_owned(nm_installed_client *);
int nm_installed_fate_read(nm_installed_client *,nm_installed_fate *);
void nm_installed_release(nm_installed_client *);
/* Called only by the original capsule's fixed native root_store borrower. */
int nm_installed_borrow_root_store(nm_installed_client *,nr_root_store_io **);
/* Internal close barrier: 1 ready, 0 other Native holders busy, -1 unknown. */
int nm_installed_root_store_close_ready(nm_installed_client *,nr_root_store_io *);
#ifdef MI_FIXTURE_BUILD
/* Bounded C component seam. No JavaScript generic family opener. */
int nm_fixture_borrow_authority_store(nm_installed_client *,uint32_t,const unsigned char[32],nr_root_store_io **);
#endif
#ifdef __cplusplus
}
#endif
#endif
