#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sqlite3.h>
#include "installed-main-client.h"
#include "original-root-io-vfs.h"

#if !defined(MI_FIXTURE_BUILD) || !defined(NR_ROOT_IO_COMPONENT)
#error "The live component fixture must never be built as production Main"
#endif
/* Defined by the original producing client, never implemented by this test. */
int nr_component_borrow_original_root_store(nm_installed_client *, nr_root_store_io **);

static int execute(sqlite3 *db, const char *sql) {
    char *error = NULL;
    int code = sqlite3_exec(db, sql, NULL, NULL, &error);
    if (code != SQLITE_OK) fprintf(stderr, "ORIGINAL_SQLITE_FAILURE:%d:%s\n", code, error ? error : "");
    sqlite3_free(error);
    return code == SQLITE_OK;
}
static int diagnostic_row(void *unused, int count, char **values, char **names) {
    (void)unused;
    for (int i = 0; i < count; ++i) fprintf(stderr, "ORIGINAL_SQLITE_ROW:%s=%s\n", names[i], values[i] ? values[i] : "NULL");
    return 0;
}

int main(void) {
    char mode[32] = "basic";
    if (fgets(mode, sizeof(mode), stdin)) mode[strcspn(mode, "\n")] = 0;
    nm_installed_client *client = nm_installed_create();
    nr_root_store_io *io = NULL;
    nr_original_root_vfs *family = NULL;
    const nr_root_bootstrap_claim *claim = NULL;
    sqlite3 *db = NULL;
    sqlite3_stmt *held = NULL;
    nr_root_store_identity identity;
    nm_installed_fate fate = {0};
    int failure = 0, busy = 0, close_while_busy = 0, second_denied = 0, foreign_journal = 0;
    int recovered = 0, once_denied = 0, cold_claim_denied = 0;
    char pool_id[65] = {0};
    if (!client || !nm_installed_connect(client)) { failure = 21; goto cleanup; }
    if (!nr_component_borrow_original_root_store(client, &io) ||
        !nr_root_store_read_identity(io, &identity)) { failure = 22; goto cleanup; }
    if (identity.birth_state == NR_CREATED) {
        if (strcmp(mode, "basic") || !nr_root_store_claim_fresh(io, &claim) ||
            !nr_root_store_read_claim(io, claim, &identity)) { failure = 23; goto cleanup; }
    } else if (identity.birth_state != NR_CLAIMED && identity.birth_state != NR_BOUND) {
        failure = 39; goto cleanup;
    }
    if (!claim) {
        const nr_root_bootstrap_claim *replayed = NULL;
        nm_installed_fate before = {0}, after = {0};
        if (!nm_installed_fate_read(client, &before)) { failure = 43; goto cleanup; }
        cold_claim_denied = !nr_root_store_claim_fresh(io, &replayed) && !replayed &&
            nm_installed_fate_read(client, &after) && before.root_sequence == after.root_sequence;
        if (!cold_claim_denied) { failure = 44; goto cleanup; }
    }
    for (int i = 0; i < 32; ++i) snprintf(pool_id + 2 * i, 3, "%02x", identity.pool_id[i]);
    int created = nr_original_root_vfs_create(io, &family);
    int opened = created == SQLITE_OK ? nr_original_root_vfs_open(family, &db) : -1;
    if (created != SQLITE_OK || opened != SQLITE_OK) {
        fprintf(stderr, "ORIGINAL_VFS_OPEN_FAILURE:create=%d:open=%d:sqlite=%s\n",
                created, opened, db ? sqlite3_errmsg(db) : "no-handle");
        if (db) {
            sqlite3_exec(db, "PRAGMA journal_mode;PRAGMA temp_store;PRAGMA synchronous;PRAGMA mmap_size", diagnostic_row, NULL, NULL);
        }
        failure = 24; goto cleanup;
    }
    nr_original_root_vfs *other_family = NULL;
    sqlite3 *other_db = NULL;
    nm_installed_fate before_once = {0}, after_once = {0};
    if (!nm_installed_fate_read(client, &before_once)) { failure = 45; goto cleanup; }
    once_denied = nr_original_root_vfs_create(io, &other_family) == SQLITE_AUTH && !other_family &&
        nr_original_root_vfs_open(family, &other_db) == SQLITE_AUTH && !other_db &&
        nm_installed_fate_read(client, &after_once) && before_once.root_sequence == after_once.root_sequence;
    if (!once_denied) { failure = 46; goto cleanup; }
    if (!strcmp(mode, "crash")) {
        if (claim || !execute(db, "BEGIN IMMEDIATE;UPDATE evidence SET body=zeroblob(524288) WHERE id=1;") ||
            sqlite3_db_cacheflush(db) != SQLITE_OK) { failure = 40; goto cleanup; }
        printf("{\"kind\":\"original-root-io-vfs-component-crash\",\"poolId\":\"%s\",\"freshClaim\":false,\"coldClaimZeroIo\":%s,\"productionQualified\":false}\n", pool_id, cold_claim_denied ? "true" : "false");
        fflush(stdout);
        _exit(91); /* Actual process loss leaves a real SQLite hot journal. */
    }
    if (!strcmp(mode, "recover")) {
        if (claim || sqlite3_prepare_v2(db, "SELECT length(body) FROM evidence", -1, &held, NULL) != SQLITE_OK ||
            sqlite3_step(held) != SQLITE_ROW || sqlite3_column_int(held, 0) != 262144) { failure = 41; goto cleanup; }
        recovered = 1;
        goto cleanup;
    }
    if (strcmp(mode, "basic")) { failure = 42; goto cleanup; }
    if (!execute(db, "BEGIN IMMEDIATE;CREATE TABLE evidence(id INTEGER PRIMARY KEY,body BLOB);"
                     "INSERT INTO evidence VALUES(1,zeroblob(262144));COMMIT;")) { failure = 25; goto cleanup; }
    sqlite3_vfs *vfs = NULL;
    if (sqlite3_file_control(db, "main", SQLITE_FCNTL_VFS_POINTER, &vfs) != SQLITE_OK || !vfs) { failure = 26; goto cleanup; }
    const char *journal = sqlite3_filename_journal(sqlite3_db_filename(db, "main"));
    char *copy = journal ? malloc(strlen(journal) + 1) : NULL;
    sqlite3_file *foreign = calloc(1, (size_t)vfs->szOsFile);
    nm_installed_fate before_foreign = {0}, after_foreign = {0};
    if (!copy || !foreign || !nm_installed_fate_read(client, &before_foreign)) {
        free(copy); free(foreign); failure = 37; goto cleanup;
    }
    memcpy(copy, journal, strlen(journal) + 1);
    int foreign_code = vfs->xOpen(vfs, copy, foreign,
        SQLITE_OPEN_MAIN_JOURNAL | SQLITE_OPEN_READWRITE, NULL);
    foreign_journal = foreign_code == SQLITE_CANTOPEN && !foreign->pMethods &&
        nm_installed_fate_read(client, &after_foreign) &&
        before_foreign.root_sequence == after_foreign.root_sequence;
    free(copy); free(foreign);
    if (!foreign_journal) { failure = 38; goto cleanup; }
    sqlite3 *second = NULL;
    int code = sqlite3_open_v2(sqlite3_db_filename(db, "main"), &second,
                             SQLITE_OPEN_READWRITE, vfs->zName);
    second_denied = code != SQLITE_OK;
    if (second && sqlite3_close(second) != SQLITE_OK) { failure = 27; goto cleanup; }
    if (!second_denied) { failure = 28; goto cleanup; }
    if (sqlite3_prepare_v2(db, "SELECT length(body) FROM evidence", -1, &held, NULL) != SQLITE_OK ||
        sqlite3_step(held) != SQLITE_ROW || sqlite3_column_int(held, 0) != 262144) { failure = 29; goto cleanup; }
    busy = nr_original_root_vfs_close(family, &db) == NR_BUSY_HELD && db != NULL;
    if (!busy) { failure = 30; goto cleanup; }
    close_while_busy = nm_installed_close_owned(client);
    if (close_while_busy) { failure = 31; goto cleanup; }
    if (sqlite3_finalize(held) != SQLITE_OK) { held = NULL; failure = 32; goto cleanup; }
    held = NULL;
cleanup:
    if (held && sqlite3_finalize(held) != SQLITE_OK && !failure) failure = 33;
    if (family && db && nr_original_root_vfs_close(family, &db) != NR_SQL_FILES_CLOSED && !failure) failure = 34;
    if (client && !nm_installed_close_owned(client) && !failure) failure = 35;
    if (client && !nm_installed_fate_read(client, &fate) && !failure) failure = 36;
    printf("{\"kind\":\"original-root-io-vfs-live-component\",\"failure\":%d,"
           "\"busyHeld\":%s,\"globalCloseBlocked\":%s,\"secondConnectionDenied\":%s,"
           "\"foreignJournalZeroIo\":%s,\"rootFilesClosed\":%s,\"unknown\":%s,\"rootSequence\":%llu,"
           "\"poolId\":\"%s\",\"freshClaim\":%s,\"hotJournalRecovered\":%s,\"onceZeroIo\":%s,\"coldClaimZeroIo\":%s,\"productionQualified\":false}\n", failure, busy ? "true" : "false",
           busy && !close_while_busy ? "true" : "false", second_denied ? "true" : "false",
           foreign_journal ? "true" : "false", fate.root_files_closed ? "true" : "false", fate.unknown ? "true" : "false",
           (unsigned long long)fate.root_sequence, pool_id, claim ? "true" : "false", recovered ? "true" : "false",
           once_denied ? "true" : "false", cold_claim_denied ? "true" : "false");
    nm_installed_release(client);
    return failure ? 1 : 0;
}
