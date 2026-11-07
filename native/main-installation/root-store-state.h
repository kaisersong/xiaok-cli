#ifndef XIAOK_MAIN_INSTALLATION_ROOT_STORE_STATE_H
#define XIAOK_MAIN_INSTALLATION_ROOT_STORE_STATE_H
/* Private helper-owned filesystem journal; never a business database. */
typedef struct mi_store_state {
 int receipt_fd,phase,journal_state,journal_readonly,last_closed_known;
 uint64_t sequence,generation;
 unsigned char anchor[320],namespace_id[32],birth_id[32],pool_id[32],claim_id[32];
 unsigned char profile[32],anchor_digest[32],head[32],audit_ticket[32],ticket[32],operation[32],claim_nonce[32];
 uint32_t claim_pid;
 struct stat anchor_identity,receipt_identity;
} mi_store_state;
/* One original file lease, shared by Root and the closed authority families.
 * Shared Main birth, channel keys and sequence live only in the parent state. */
typedef struct mi_store_lease {
 int authority,parent,anchor_fd,validation_fd,files[4],unknown,closed,io_entered;
 int ancestors[2],ancestor_count;
 int failed_close_fds[10],failed_close_codes[10],failed_close_count,close_error_present,close_error;
 struct stat authority_identity,file_identity[4],ancestor_identity[2];
 mi_store_state store;
 uint32_t family;
 unsigned char scope[32],token[32],expected_profile[32];
 char directory_name[65],database_name[40],journal_name[48],wal_name[48],shm_name[48];
} mi_store_lease;

#endif
