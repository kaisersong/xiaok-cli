#ifndef NR_ORIGINAL_ROOT_IO_VFS_H
#define NR_ORIGINAL_ROOT_IO_VFS_H
#include <sqlite3.h>
#include "root-store-io.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct nr_original_root_vfs nr_original_root_vfs;
/* Native-only: no path, VFS name, SQL or caller callback. */
int nr_original_root_vfs_create(nr_root_store_io *, nr_original_root_vfs **);
int nr_original_root_vfs_open(nr_original_root_vfs *, sqlite3 **);
void nr_original_root_vfs_seal(nr_original_root_vfs *);
enum nr_root_release_result nr_original_root_vfs_close(nr_original_root_vfs *, sqlite3 **);
#ifdef __cplusplus
}
#endif
#endif
