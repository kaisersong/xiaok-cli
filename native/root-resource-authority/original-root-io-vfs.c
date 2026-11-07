/* Non-default system-SQLite VFS for the original RootDB only. */
#include "original-root-io-vfs.h"
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct nr_vfs_file nr_vfs_file;
struct nr_original_root_vfs {
    nr_original_root_vfs *next;
    nr_root_store_io *io;
    nr_root_store_identity identity;
    sqlite3_vfs vfs;
    sqlite3_vfs *nonfile;
    sqlite3 *db;
    nr_vfs_file *files, *main_file;
    const char *main_name, *journal_name, *wal_name;
    char vfs_name[96], database_token[128];
    uint64_t journal_generation;
    unsigned char journal_ticket[32];
    int main_entered, open_entered, sealed, unknown, retired, sql_closed, unregistered;
    int open_files, callbacks;
};
struct nr_vfs_file {
    nr_vfs_file *next;
    nr_original_root_vfs *family;
    sqlite3_file *original;
    nr_root_store_file *handle;
    int database, readonly, closed, lock_level;
};
static _Thread_local nr_original_root_vfs *families;
static _Thread_local nr_original_root_vfs *opening;

static nr_original_root_vfs *member(nr_original_root_vfs *candidate) {
    for (nr_original_root_vfs *f = families; f; f = f->next) {
        if (f == candidate) return f;
    }
    return NULL;
}
static nr_original_root_vfs *vfs_member(sqlite3_vfs *candidate) {
    for (nr_original_root_vfs *f = families; f; f = f->next) {
        if (&f->vfs == candidate) return f;
    }
    return NULL;
}
static nr_vfs_file *file_member(sqlite3_file *candidate) {
    for (nr_original_root_vfs *f = families; f; f = f->next) {
        for (nr_vfs_file *r = f->files; r; r = r->next) {
            if (r->original == candidate && !r->closed) return r;
        }
    }
    return NULL;
}
static int same_fact(const nr_root_file_fact *a, const nr_root_file_fact *b) {
    return a->device == b->device && a->inode == b->inode && a->uid == b->uid &&
        a->mode == b->mode && a->nlink == b->nlink;
}
static int same_identity(const nr_root_store_identity *a, const nr_root_store_identity *b) {
    return a->format == b->format && a->main_principal_uid == b->main_principal_uid &&
        a->file_owner_uid == b->file_owner_uid &&
        !memcmp(a->namespace_id, b->namespace_id, 32) && !memcmp(a->birth_id, b->birth_id, 32) &&
        !memcmp(a->pool_id, b->pool_id, 32) && !memcmp(a->claim_id, b->claim_id, 32) &&
        !memcmp(a->anchor_digest, b->anchor_digest, 32) && !memcmp(a->profile_digest, b->profile_digest, 32) &&
        same_fact(&a->directory, &b->directory) && same_fact(&a->database, &b->database) &&
        same_fact(&a->issuer_lock, &b->issuer_lock);
}
static int current(nr_original_root_vfs *f, nr_root_store_identity *result) {
    nr_root_store_identity now;
    if (!f || f->unknown || f->retired) return 0;
    if (!nr_root_store_read_identity(f->io, &now) || !same_identity(&f->identity, &now) ||
        (now.birth_state != NR_CLAIMED && now.birth_state != NR_BOUND) ||
        now.birth_state < f->identity.birth_state) {
        f->unknown = 1;
        return 0;
    }
    f->identity.birth_state = now.birth_state;
    if (result) *result = now;
    return 1;
}
static int ready(nr_vfs_file *r) {
    return r && r->handle && !r->closed && current(r->family, NULL);
}
static int failed(nr_vfs_file *r, int code) {
    if (r) r->family->unknown = 1;
    return code;
}
static int close_file(sqlite3_file *original) {
    nr_vfs_file *r = file_member(original);
    if (!r) return SQLITE_IOERR_CLOSE;
    nr_original_root_vfs *f = r->family;
    ++f->callbacks;
    /* Accepted negative close is independent of positive current(). */
    int good = nr_root_store_close_file(r->handle);
    if (good) {
        r->closed = 1;
        --f->open_files;
        if (r->database) f->main_name = f->journal_name = f->wal_name = NULL;
    } else f->unknown = 1;
    --f->callbacks;
    return good ? SQLITE_OK : SQLITE_IOERR_CLOSE;
}
static int read_file(sqlite3_file *original, void *buffer, int amount, sqlite3_int64 offset) {
    nr_vfs_file *r = file_member(original);
    if (!buffer || amount < 0 || offset < 0 || (uint64_t)offset > INT64_MAX - (uint32_t)amount || !ready(r)) return SQLITE_IOERR_READ;
    unsigned char *out = buffer;
    uint32_t done = 0;
    while (done < (uint32_t)amount) {
        uint32_t part = (uint32_t)amount - done;
        if (part > 65536) part = 65536;
        uint32_t actual = 0;
        if (!nr_root_store_read_at(r->handle, (uint64_t)offset + done, out + done, part, &actual) || actual > part) return failed(r, SQLITE_IOERR_READ);
        done += actual;
        if (actual < part) {
            memset(out + done, 0, (size_t)amount - done);
            return SQLITE_IOERR_SHORT_READ;
        }
    }
    return SQLITE_OK;
}
static int write_file(sqlite3_file *original, const void *buffer, int amount, sqlite3_int64 offset) {
    nr_vfs_file *r = file_member(original);
    if (!buffer || amount < 0 || offset < 0 || (uint64_t)offset > INT64_MAX - (uint32_t)amount || !ready(r)) return SQLITE_IOERR_WRITE;
    if (r->readonly) return SQLITE_READONLY;
    const unsigned char *input = buffer;
    uint32_t done = 0;
    while (done < (uint32_t)amount) {
        uint32_t part = (uint32_t)amount - done;
        uint32_t maximum = r->database ? 65536 : 65496;
        if (part > maximum) part = maximum;
        uint32_t actual = 0;
        if (!nr_root_store_write_at(r->handle, (uint64_t)offset + done, input + done, part, &actual) || actual != part) return failed(r, SQLITE_IOERR_WRITE);
        done += actual;
    }
    return SQLITE_OK;
}
static int truncate_file(sqlite3_file *original, sqlite3_int64 size) {
    nr_vfs_file *r = file_member(original);
    if (size < 0 || !ready(r)) return SQLITE_IOERR_TRUNCATE;
    if (r->readonly) return SQLITE_READONLY;
    return nr_root_store_truncate(r->handle, (uint64_t)size) ? SQLITE_OK : failed(r, SQLITE_IOERR_TRUNCATE);
}
static int sync_file(sqlite3_file *original, int flags) {
    nr_vfs_file *r = file_member(original);
    int level = flags & 0x0f;
    if ((level != SQLITE_SYNC_NORMAL && level != SQLITE_SYNC_FULL) ||
        (flags & ~(0x0f | SQLITE_SYNC_DATAONLY)) || !ready(r)) return SQLITE_IOERR_FSYNC;
    return nr_root_store_sync(r->handle) ? SQLITE_OK : failed(r, SQLITE_IOERR_FSYNC);
}
static int size_file(sqlite3_file *original, sqlite3_int64 *size) {
    nr_vfs_file *r = file_member(original);
    if (!size || !ready(r)) return SQLITE_IOERR_FSTAT;
    uint64_t actual;
    if (!nr_root_store_size(r->handle, &actual) || actual > INT64_MAX) return failed(r, SQLITE_IOERR_FSTAT);
    *size = (sqlite3_int64)actual;
    return SQLITE_OK;
}
static int lock_file(sqlite3_file *original, int level) {
    nr_vfs_file *r = file_member(original);
    if (!r || !r->database || level < SQLITE_LOCK_SHARED || level > SQLITE_LOCK_EXCLUSIVE || !ready(r)) return SQLITE_IOERR_LOCK;
    if (level > r->lock_level) r->lock_level = level;
    return SQLITE_OK;
}
static int unlock_file(sqlite3_file *original, int level) {
    nr_vfs_file *r = file_member(original);
    if (!r || !r->database || (level != SQLITE_LOCK_NONE && level != SQLITE_LOCK_SHARED)) return SQLITE_IOERR_UNLOCK;
    if (level < r->lock_level) r->lock_level = level;
    return SQLITE_OK;
}
static int reserved_file(sqlite3_file *original, int *reserved) {
    nr_vfs_file *r = file_member(original);
    if (!r || !r->database || !reserved) return SQLITE_IOERR_CHECKRESERVEDLOCK;
    *reserved = r->lock_level >= SQLITE_LOCK_RESERVED;
    return SQLITE_OK;
}
static int control_file(sqlite3_file *original, int operation, void *argument) {
    nr_vfs_file *r = file_member(original);
    if (!r) return SQLITE_IOERR;
    if (operation == SQLITE_FCNTL_LOCKSTATE && argument) {
        *(int *)argument = r->lock_level;
        return SQLITE_OK;
    }
    return SQLITE_NOTFOUND;
}
static int sector_file(sqlite3_file *original) { return file_member(original) ? 4096 : 0; }
static int device_file(sqlite3_file *original) { (void)original; return 0; }
static const sqlite3_io_methods file_methods = {
    .iVersion = 1, .xClose = close_file, .xRead = read_file, .xWrite = write_file,
    .xTruncate = truncate_file, .xSync = sync_file, .xFileSize = size_file,
    .xLock = lock_file, .xUnlock = unlock_file, .xCheckReservedLock = reserved_file,
    .xFileControl = control_file, .xSectorSize = sector_file, .xDeviceCharacteristics = device_file,
};

static int journal_flags(int flags) {
    int protection = flags & 0x00700000;
    int allowed = SQLITE_OPEN_READONLY | SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE |
        SQLITE_OPEN_EXCLUSIVE | SQLITE_OPEN_MAIN_JOURNAL | SQLITE_OPEN_NOFOLLOW | 0x00700000;
    return !(flags & ~allowed) && (flags & SQLITE_OPEN_MAIN_JOURNAL) &&
        (protection == 0 || protection == 0x00300000) &&
        ((flags & (SQLITE_OPEN_READONLY | SQLITE_OPEN_READWRITE)) == SQLITE_OPEN_READONLY ||
         (flags & (SQLITE_OPEN_READONLY | SQLITE_OPEN_READWRITE)) == SQLITE_OPEN_READWRITE) &&
        (!(flags & SQLITE_OPEN_CREATE) || !(flags & SQLITE_OPEN_READONLY));
}

static int open_file(sqlite3_vfs *vfs, const char *name, sqlite3_file *original, int flags, int *out_flags) {
    nr_original_root_vfs *f = vfs_member(vfs);
    nr_root_store_identity before;
    if (!f || !original) return SQLITE_CANTOPEN;
    original->pMethods = NULL;
    if (f->sealed || f->retired || f->unknown || !name) return SQLITE_CANTOPEN;
    int database = (flags & SQLITE_OPEN_MAIN_DB) != 0;
    if (database) {
        if (opening != f || f->main_entered || strcmp(name, f->database_token) ||
            (flags & ~(SQLITE_OPEN_MAIN_DB | SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOFOLLOW)) ||
            !(flags & SQLITE_OPEN_READWRITE)) return SQLITE_CANTOPEN;
    } else {
        /* Pointer membership precedes the filename API, whose foreign input is UB. */
        if (!f->main_file || f->main_file->closed || name != f->journal_name || !journal_flags(flags) ||
            sqlite3_filename_database(name) != f->main_name) return SQLITE_CANTOPEN;
        for (nr_vfs_file *p = f->files; p; p = p->next) {
            if (!p->database && !p->closed) return SQLITE_CANTOPEN;
        }
    }
    if (!current(f, &before)) return SQLITE_CANTOPEN;
    if (!database && (flags & SQLITE_OPEN_EXCLUSIVE) && before.journal_present) return SQLITE_CANTOPEN;
    nr_vfs_file *r = calloc(1, sizeof(*r));
    if (!r) return SQLITE_NOMEM;
    r->family = f;
    r->original = original;
    r->database = database;
    r->readonly = (flags & SQLITE_OPEN_READONLY) != 0;
    r->next = f->files;
    f->files = r;
    ++f->callbacks;
    int good;
    if (database) {
        f->main_entered = 1;
        f->main_name = sqlite3_filename_database(name);
        f->journal_name = sqlite3_filename_journal(name);
        f->wal_name = sqlite3_filename_wal(name);
        if (!f->main_name || !f->journal_name || !f->wal_name) {
            f->unknown = 1;
            --f->callbacks;
            return SQLITE_CANTOPEN;
        }
        good = nr_root_store_open_database(f->io, &r->handle);
    } else if ((flags & SQLITE_OPEN_CREATE) && !before.journal_present) {
        good = nr_root_store_create_journal(f->io, &r->handle);
    } else {
        /* CREATE means create-if-missing, not O_EXCL. Known existing journals
         * retain their inode/generation; a failed CREATE never falls back. */
        int present = 0;
        good = nr_root_store_open_journal(f->io, r->readonly ? NR_READONLY : NR_READWRITE, &present, &r->handle);
        if (good && !present) {
            r->closed = 1;
            --f->callbacks;
            return SQLITE_CANTOPEN;
        }
    }
    if (!good || !r->handle) {
        f->unknown = 1;
        --f->callbacks;
        return SQLITE_IOERR;
    }
    ++f->open_files;
    if (database) f->main_file = r;
    else {
        nr_root_store_identity now;
        if (!current(f, &now) || !now.journal_present || now.journal_state != NR_JOURNAL_PRESENT) {
            f->unknown = 1;
            /* A real handle is retained even if its subsequent identity fails. */
            original->pMethods = &file_methods;
            --f->callbacks;
            return SQLITE_IOERR;
        }
        f->journal_generation = now.journal_generation;
        memcpy(f->journal_ticket, now.journal_ticket, 32);
    }
    original->pMethods = &file_methods;
    if (out_flags) *out_flags = flags;
    --f->callbacks;
    return SQLITE_OK;
}

static int access_file(sqlite3_vfs *vfs, const char *name, int flags, int *exists) {
    nr_original_root_vfs *f = vfs_member(vfs);
    if (!exists) return SQLITE_IOERR_ACCESS;
    *exists = 0;
    if (!f || !name || flags < SQLITE_ACCESS_EXISTS || flags > SQLITE_ACCESS_READ || !f->main_file || f->main_file->closed) return SQLITE_IOERR_ACCESS;
    if (name != f->journal_name && name != f->wal_name && name != f->main_name) return SQLITE_IOERR_ACCESS;
    nr_root_store_identity now;
    if (!current(f, &now)) return SQLITE_IOERR_ACCESS;
    if (name == f->journal_name) {
        *exists = now.journal_present != 0;
        return SQLITE_OK;
    }
    if (name == f->wal_name) {
        /* The original helper's successful identity/current checks real WAL/SHM absence. */
        return SQLITE_OK;
    }
    if (name == f->main_name) {
        *exists = 1;
        return SQLITE_OK;
    }
    return SQLITE_IOERR_ACCESS;
}

static int delete_file(sqlite3_vfs *vfs, const char *name, int sync_directory) {
    nr_original_root_vfs *f = vfs_member(vfs);
    if (!f || !f->main_file || f->main_file->closed || name != f->journal_name ||
        (sync_directory != 0 && sync_directory != 1) || !current(f, NULL)) return SQLITE_IOERR_DELETE;
    ++f->callbacks;
    int good = nr_root_store_delete_journal(f->io, f->journal_generation, f->journal_ticket);
    if (good && sync_directory) good = nr_root_store_directory_sync(f->io);
    if (!good) f->unknown = 1;
    --f->callbacks;
    return good ? SQLITE_OK : SQLITE_IOERR_DELETE;
}

static int full_path(sqlite3_vfs *vfs, const char *name, int capacity, char *out) {
    nr_original_root_vfs *f = vfs_member(vfs);
    if (!f || opening != f || f->main_entered || !name || strcmp(name, f->database_token) ||
        !out || capacity <= 0 || strlen(f->database_token) >= (size_t)capacity) return SQLITE_CANTOPEN;
    memcpy(out, f->database_token, strlen(f->database_token) + 1);
    return SQLITE_OK;
}
static void *dl_open(sqlite3_vfs *vfs, const char *name) { (void)vfs; (void)name; return NULL; }
static void dl_error(sqlite3_vfs *vfs, int n, char *out) {
    (void)vfs;
    if (n > 0 && out) snprintf(out, (size_t)n, "%s", "Root VFS extensions unavailable");
}
static void (*dl_symbol(sqlite3_vfs *vfs, void *handle, const char *name))(void) {
    (void)vfs; (void)handle; (void)name; return NULL;
}
static void dl_close(sqlite3_vfs *vfs, void *handle) { (void)vfs; (void)handle; }
static int randomness(sqlite3_vfs *vfs, int n, char *out) {
    nr_original_root_vfs *f = vfs_member(vfs);
    return f && f->nonfile->xRandomness ? f->nonfile->xRandomness(f->nonfile, n, out) : 0;
}
static int sleep_time(sqlite3_vfs *vfs, int microseconds) {
    nr_original_root_vfs *f = vfs_member(vfs);
    return f && f->nonfile->xSleep ? f->nonfile->xSleep(f->nonfile, microseconds) : 0;
}
static int current_time(sqlite3_vfs *vfs, double *out) {
    nr_original_root_vfs *f = vfs_member(vfs);
    return f && f->nonfile->xCurrentTime ? f->nonfile->xCurrentTime(f->nonfile, out) : SQLITE_ERROR;
}
static int last_error(sqlite3_vfs *vfs, int n, char *out) {
    nr_original_root_vfs *f = vfs_member(vfs);
    return f && f->nonfile->xGetLastError ? f->nonfile->xGetLastError(f->nonfile, n, out) : 0;
}

int nr_original_root_vfs_create(nr_root_store_io *io, nr_original_root_vfs **out) {
    if (!out) return SQLITE_MISUSE;
    *out = NULL;
    if (!io) return SQLITE_AUTH;
    for (nr_original_root_vfs *p = families; p; p = p->next) {
        if (p->io == io) return SQLITE_AUTH;
    }
    nr_original_root_vfs *f = calloc(1, sizeof(*f));
    if (!f) return SQLITE_NOMEM;
    f->io = io;
    f->next = families;
    families = f; /* Strong custody precedes the original identity SDK. */
    if (!nr_root_store_read_identity(io, &f->identity) || f->identity.format != 2 ||
        (f->identity.birth_state != NR_CLAIMED && f->identity.birth_state != NR_BOUND)) {
        f->unknown = 1;
        return SQLITE_AUTH;
    }
    f->nonfile = sqlite3_vfs_find(NULL);
    if (!f->nonfile || sqlite3_libversion_number() < 3038000) {
        f->unknown = 1;
        return SQLITE_CANTOPEN;
    }
    snprintf(f->vfs_name, sizeof(f->vfs_name), "original-root-io-v2-%p", (void *)f);
    snprintf(f->database_token, sizeof(f->database_token), "original-root-store:%p", (void *)f);
    f->vfs = (sqlite3_vfs){
        .iVersion = 1, .szOsFile = sizeof(sqlite3_file), .mxPathname = sizeof(f->database_token),
        .zName = f->vfs_name, .pAppData = f, .xOpen = open_file, .xDelete = delete_file,
        .xAccess = access_file, .xFullPathname = full_path, .xDlOpen = dl_open,
        .xDlError = dl_error, .xDlSym = dl_symbol, .xDlClose = dl_close,
        .xRandomness = randomness, .xSleep = sleep_time, .xCurrentTime = current_time,
        .xGetLastError = last_error,
    };
    int code = sqlite3_vfs_register(&f->vfs, 0);
    if (code != SQLITE_OK) { f->unknown = 1; return code; }
    *out = f;
    return SQLITE_OK;
}

static int one_value(sqlite3 *db, const char *sql, const char *text, int integer) {
    sqlite3_stmt *q = NULL;
    int good = sqlite3_prepare_v2(db, sql, -1, &q, NULL) == SQLITE_OK && sqlite3_step(q) == SQLITE_ROW;
    if (good && text) {
        const unsigned char *value = sqlite3_column_text(q, 0);
        good = sqlite3_column_type(q, 0) == SQLITE_TEXT && value && !strcmp((const char *)value, text);
    } else if (good) good = sqlite3_column_type(q, 0) == SQLITE_INTEGER && sqlite3_column_int(q, 0) == integer;
    if (good) good = sqlite3_step(q) == SQLITE_DONE;
    if (q && sqlite3_finalize(q) != SQLITE_OK) good = 0;
    return good;
}

static int mmap_disabled(sqlite3 *db) {
    sqlite3_stmt *q = NULL;
    int good = sqlite3_prepare_v2(db, "PRAGMA mmap_size", -1, &q, NULL) == SQLITE_OK;
    if (good) {
        int step = sqlite3_step(q);
        if (step == SQLITE_DONE) {
            /* SQLite emits no row when this exact original iVersion=1
             * methods table has no xFetch/xUnfetch capability at all. */
            good = file_methods.iVersion == 1 && !file_methods.xFetch && !file_methods.xUnfetch;
        } else {
            good = step == SQLITE_ROW && sqlite3_column_type(q, 0) == SQLITE_INTEGER &&
                sqlite3_column_int64(q, 0) == 0 && sqlite3_step(q) == SQLITE_DONE;
        }
    }
    if (q && sqlite3_finalize(q) != SQLITE_OK) good = 0;
    return good;
}

int nr_original_root_vfs_open(nr_original_root_vfs *candidate, sqlite3 **out) {
    if (!out) return SQLITE_MISUSE;
    *out = NULL;
    nr_original_root_vfs *f = member(candidate);
    if (!f || f->sealed || f->retired || f->open_entered || opening || !current(f, NULL)) return SQLITE_AUTH;
    f->open_entered = 1;
    opening = f;
    int code = sqlite3_open_v2(f->database_token, &f->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOFOLLOW, f->vfs_name);
    opening = NULL;
    *out = f->db;
    if (code != SQLITE_OK) {
        if (!f->db) f->unknown = 1;
        return code;
    }
    /* Never repair/switch a cold WAL database into DELETE. */
    if (!one_value(f->db, "PRAGMA journal_mode", "delete", 0) ||
        sqlite3_exec(f->db, "PRAGMA temp_store=MEMORY;PRAGMA synchronous=FULL;PRAGMA mmap_size=0", NULL, NULL, NULL) != SQLITE_OK ||
        !one_value(f->db, "PRAGMA temp_store", NULL, 2) ||
        !one_value(f->db, "PRAGMA synchronous", NULL, 2) ||
        !mmap_disabled(f->db)) return SQLITE_CANTOPEN;
    return SQLITE_OK;
}

void nr_original_root_vfs_seal(nr_original_root_vfs *candidate) {
    nr_original_root_vfs *f = member(candidate);
    if (f) f->sealed = 1;
}

enum nr_root_release_result nr_original_root_vfs_close(nr_original_root_vfs *candidate, sqlite3 **db) {
    nr_original_root_vfs *f = member(candidate);
    if (!f || !db || *db != f->db) return NR_UNKNOWN_HELD;
    if (f->retired) return f->unknown ? NR_UNKNOWN_HELD : NR_SQL_FILES_CLOSED;
    f->sealed = 1;
    if (!f->sql_closed) {
        if (!f->db) return NR_UNKNOWN_HELD;
        int code = sqlite3_close(f->db);
        if (code == SQLITE_BUSY) return NR_BUSY_HELD;
        if (code != SQLITE_OK) { f->unknown = 1; return NR_UNKNOWN_HELD; }
        f->sql_closed = 1;
        f->db = NULL;
        *db = NULL;
    }
    if (f->open_files || f->callbacks || f->unknown) return NR_UNKNOWN_HELD;
    if (!f->unregistered) {
        if (sqlite3_vfs_unregister(&f->vfs) != SQLITE_OK) { f->unknown = 1; return NR_UNKNOWN_HELD; }
        f->unregistered = 1;
    }
    enum nr_root_release_result result = nr_root_store_release_owned(f->io);
    if (result != NR_SQL_FILES_CLOSED) return result;
    f->retired = 1;
    /* Retain the tiny identity/member tombstone; old pointers never reopen. */
    return NR_SQL_FILES_CLOSED;
}
