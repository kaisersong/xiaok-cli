#ifndef XIAOK_ORIGINAL_ROOT_STORE_DISPATCH_H
#define XIAOK_ORIGINAL_ROOT_STORE_DISPATCH_H
#include "root-store-io.h"
/* Native-only fixed capsule ABI. Never accepted by N-API or an installer.
 * The consuming CPP first authenticates the original Private capsule and
 * destination borrower. Each function still checks the source DSO registry. */
#define NR_STORE_DISPATCH_MAGIC UINT64_C(0x584b524f4f544436)
#define NR_STORE_DISPATCH_VERSION 1u
typedef struct nm_root_store_dispatch {
 uint64_t magic;uint32_t version,bytes;
 int (*read_identity)(nr_root_store_io *io, nr_root_store_identity *out);
 int (*claim_fresh)(nr_root_store_io *io, const nr_root_bootstrap_claim **out);
 int (*read_claim)(nr_root_store_io *io, const nr_root_bootstrap_claim *claim, nr_root_store_identity *out);
 int (*bind_bootstrap)(nr_root_store_io *io, enum nr_root_bind_mode mode, const nr_root_bootstrap_claim *claim, const nr_root_store_identity *verified);
 int (*open_database)(nr_root_store_io *io, nr_root_store_file **out);
 int (*open_journal)(nr_root_store_io *io, enum nr_root_open_mode mode, int *present, nr_root_store_file **out);
 int (*create_journal)(nr_root_store_io *io, nr_root_store_file **out);
 int (*read_at)(nr_root_store_file *file, uint64_t offset, void *output, uint32_t amount, uint32_t *actual);
 int (*write_at)(nr_root_store_file *file, uint64_t offset, const void *input, uint32_t amount, uint32_t *actual);
 int (*size)(nr_root_store_file *file, uint64_t *size);
 int (*truncate)(nr_root_store_file *file, uint64_t size);
 int (*sync)(nr_root_store_file *file);
 int (*close_file)(nr_root_store_file *file);
 int (*delete_journal)(nr_root_store_io *io, uint64_t generation, const unsigned char *ticket);
 int (*directory_sync)(nr_root_store_io *io);
 enum nr_root_release_result (*release_owned)(nr_root_store_io *io);
 int (*read_adoption_kind)(nr_root_store_io *io,enum nr_root_adoption_kind *kind);
 int (*claim_adopted)(nr_root_store_io *io,const nr_root_bootstrap_claim **out);
 int (*read_adoption)(nr_root_store_io *io,const nr_root_bootstrap_claim *claim,nr_original_pool_history *history,nr_root_store_identity *out);
} nm_root_store_dispatch;
#ifdef __cplusplus
extern "C" {
#endif
const nm_root_store_dispatch *nm_installed_root_store_dispatch(void);
/* Only the fixed CPP capsule consumer calls this after original borrow. */
int nm_installed_import_root_store(const nm_root_store_dispatch *,nr_root_store_io *);
#ifdef __cplusplus
}
#endif
#endif
