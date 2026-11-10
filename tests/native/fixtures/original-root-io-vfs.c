#include <stdint.h>
#include <stdio.h>
#include <sqlite3.h>
#include "original-root-io-vfs.h"

int main(void) {
    sqlite3_vfs *before = sqlite3_vfs_find(NULL);
    nr_original_root_vfs *family = (nr_original_root_vfs *)(uintptr_t)1;
    if (nr_original_root_vfs_create(NULL, &family) != SQLITE_AUTH || family) return 11;
    if (nr_original_root_vfs_create((nr_root_store_io *)(uintptr_t)1, &family) != SQLITE_AUTH || family) return 12;
    if (nr_original_root_vfs_create(NULL, NULL) != SQLITE_MISUSE) return 13;
    sqlite3 *db = NULL;
    if (nr_original_root_vfs_open((nr_original_root_vfs *)(uintptr_t)1, &db) != SQLITE_AUTH || db) return 14;
    if (nr_original_root_vfs_close((nr_original_root_vfs *)(uintptr_t)1, &db) != NR_UNKNOWN_HELD) return 15;
    nr_original_root_vfs_seal((nr_original_root_vfs *)(uintptr_t)1);
    if (sqlite3_vfs_find(NULL) != before) return 16;
    puts("{\"kind\":\"original-root-io-vfs-foreign-input\",\"foreignRejected\":true,\"defaultVfsUnchanged\":true,\"productionQualified\":false}");
    return 0;
}
