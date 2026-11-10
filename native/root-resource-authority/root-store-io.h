/* Fixed Native-only SPI. No N-API, JS installer, callback table or path.
 * Producer v2 implementation is separate; declarations alone mint no io/cap. */
#ifndef XIAOK_ORIGINAL_ROOT_STORE_IO_H
#define XIAOK_ORIGINAL_ROOT_STORE_IO_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct nr_main_bridge nr_main_bridge;
typedef struct nr_root_store_io nr_root_store_io;
typedef struct nr_root_store_file nr_root_store_file;
typedef struct nr_root_bootstrap_claim nr_root_bootstrap_claim;

enum nr_root_birth_state { NR_CREATED=1, NR_CLAIMED=2, NR_BOUND=3 };
enum nr_root_journal_state { NR_JOURNAL_ABSENT=0, NR_JOURNAL_PRESENT=1, NR_JOURNAL_DELETE_PENDING=2 };
enum nr_root_open_mode { NR_READONLY=1, NR_READWRITE=2 };
enum nr_root_bind_mode { NR_FRESH_COMMIT=1, NR_RECOVER_COMMITTED=2, NR_ADOPTION_COMMITTED=3 };
enum nr_root_adoption_kind { NR_ROOT_ORDINARY_BINDING=0, NR_ROOT_ADOPTED_BINDING=1 };
enum nr_root_release_result { NR_SQL_FILES_CLOSED=0, NR_BUSY_HELD=1, NR_UNKNOWN_HELD=2 };
enum { NR_ROOT_IDENTITY_WIRE_BYTES=424, NR_ROOT_ANCHOR_BYTES=320, NR_ROOT_RECEIPT_BYTES=512 };

typedef struct nr_root_file_fact {
    uint64_t device, inode;
    uint32_t uid, mode;
    uint64_t nlink;
} nr_root_file_fact;

/* Pre-adoption data read only from the original Native custody/claim. These
 * fields are not membership, authorization, or a caller-created IO handle. */
typedef struct nr_original_pool_history {
    unsigned char pool_id[32];
    uint32_t main_principal_uid;
    nr_root_file_fact directory, database, issuer_lock;
} nr_original_pool_history;

/* Host struct can contain padding. Never memcpy it to/from the BE wire. */
typedef struct nr_root_store_identity {
    uint32_t format, birth_state;
    /* birth_id is durable anchor birth, never a per-Main launch nonce. */
    unsigned char namespace_id[32], birth_id[32], pool_id[32], claim_id[32];
    unsigned char anchor_digest[32], profile_digest[32], receipt_head[32];
    uint64_t receipt_sequence;
    uint32_t main_principal_uid, file_owner_uid;
    nr_root_file_fact directory, database, issuer_lock;
    uint64_t journal_generation;
    uint32_t journal_state, journal_present;
    unsigned char journal_ticket[32];
    nr_root_file_fact journal;
} nr_root_store_identity;

/* exact_env is destination addon's original napi_env. The producer validator
 * separately verifies its node::Environment; these pointers are not aliases.
 * A's fixed private entry: same original bridge/env/cookie + adopted v2 client.
 * nr_root_store_* int: 1 success, 0 denied/unknown with original held cause.
 * nr_original_root_vfs_create/open: SQLite result codes instead. */
int nr_main_bridge_borrow_root_store(nr_main_bridge *, const void *exact_env,
                                   const void *exact_cookie, nr_root_store_io **);
int nr_main_bridge_root_store_close_ready(nr_main_bridge *,const void *exact_env,const void *exact_cookie,nr_root_store_io *);
int nr_root_store_read_identity(nr_root_store_io *, nr_root_store_identity *);
int nr_root_store_claim_fresh(nr_root_store_io *, const nr_root_bootstrap_claim **);
/* Zero caller data: original helper's authenticated, already adopted row. */
int nr_root_store_read_adoption_kind(nr_root_store_io *, enum nr_root_adoption_kind *);
int nr_root_store_claim_adopted(nr_root_store_io *, const nr_root_bootstrap_claim **);
int nr_root_store_read_adoption(nr_root_store_io *, const nr_root_bootstrap_claim *,
                                nr_original_pool_history *, nr_root_store_identity *);
/* Read claim data only after producer private membership + exact io comparison. */
int nr_root_store_read_claim(nr_root_store_io *, const nr_root_bootstrap_claim *,
                            nr_root_store_identity *);
int nr_root_store_bind_bootstrap(nr_root_store_io *, enum nr_root_bind_mode,
                                const nr_root_bootstrap_claim *,
                                const nr_root_store_identity *original_verified_identity);

/* Each file is a producer-private logical handle, never an OS descriptor.
 * io+generation+fresh per-OPEN ticket+mode+closed are private membership facts. */
int nr_root_store_open_database(nr_root_store_io *, nr_root_store_file **);
int nr_root_store_open_journal(nr_root_store_io *, enum nr_root_open_mode,
                              int *present, nr_root_store_file **);
int nr_root_store_create_journal(nr_root_store_io *, nr_root_store_file **);
int nr_root_store_read_at(nr_root_store_file *, uint64_t, void *, uint32_t, uint32_t *actual);
int nr_root_store_write_at(nr_root_store_file *, uint64_t, const void *, uint32_t, uint32_t *actual);
int nr_root_store_size(nr_root_store_file *, uint64_t *);
int nr_root_store_truncate(nr_root_store_file *, uint64_t);
int nr_root_store_sync(nr_root_store_file *);
int nr_root_store_close_file(nr_root_store_file *);
/* Delete identifies this incarnation's last successfully closed open ticket.
 * A new OPEN invalidates the prior open/closed ticket, not the inode generation. */
int nr_root_store_delete_journal(nr_root_store_io *, uint64_t, const unsigned char ticket[32]);
int nr_root_store_directory_sync(nr_root_store_io *);
enum nr_root_release_result nr_root_store_release_owned(nr_root_store_io *);
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
typedef struct nm_installed_client nm_installed_client;
int nr_component_borrow_original_root_store(nm_installed_client *,nr_root_store_io **);
#endif
#ifdef __cplusplus
}
#endif
#endif
