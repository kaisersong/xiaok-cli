// Dedicated macOS test-process interposer. Never loaded by a product launcher.
// Each injection requires the exact owned fixture root and emits only facts.
#include <stdatomic.h>
#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/param.h>
#include <unistd.h>

static atomic_bool renamed = false;
static atomic_bool injected = false;

static bool owned_fd(int fd, char *path) {
    const char *root = getenv("XIAOK_TEST_FAULT_ROOT");
    if (!root || !*root || fcntl(fd, F_GETPATH, path) != 0) return false;
    size_t length = strlen(root);
    return strncmp(path, root, length) == 0 && (path[length] == '\0' || path[length] == '/');
}

static void mark(const char *kind, bool did_rename) {
    const char *marker = getenv("XIAOK_TEST_FAULT_MARKER");
    if (!marker) return;
    int fd = open(marker, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return;
    char bytes[160];
    int length = snprintf(bytes, sizeof(bytes), "{\"injected\":\"%s\",\"renameSucceeded\":%s}\n", kind, did_rename ? "true" : "false");
    if (length > 0 && (size_t)length < sizeof(bytes)) write(fd, bytes, (size_t)length);
    close(fd);
}

static bool sync_error(int fd) {
    char path[MAXPATHLEN];
    const char *mode = getenv("XIAOK_TEST_FAULT_MODE");
    if (mode && owned_fd(fd, path)) {
        const char *root = getenv("XIAOK_TEST_FAULT_ROOT");
        const char *name = path + strlen(root);
        bool match = (strcmp(mode, "temp-fsync") == 0 && strncmp(name, "/.xiaok-auth-", 13) == 0
            && strlen(name) > 4 && strcmp(name + strlen(name) - 4, ".tmp") == 0)
            || (strcmp(mode, "dir-fsync-after-rename") == 0 && !*name && atomic_load(&renamed));
        if (match) {
            if (!atomic_exchange(&injected, true)) mark(mode, atomic_load(&renamed));
            errno = EIO;
            return true;
        }
    }
    return false;
}

static int vault_fsync(int fd) {
    if (sync_error(fd)) return -1;
    return fsync(fd);
}

// macOS Rust sync_all first uses F_FULLFSYNC and may fall back to fsync.
// Preserve the original variadic call frame exactly: forwarding it through a
// guessed C va_arg type would corrupt unrelated fcntl commands in this process.
__attribute__((used, noinline)) int vault_should_fail_sync(int fd, int command) {
    return (command == F_FULLFSYNC || command == F_BARRIERFSYNC) && sync_error(fd);
}
__attribute__((naked)) static int vault_fcntl(int fd __attribute__((unused)), int command __attribute__((unused)), ...) {
    __asm__ volatile(
        "stp x29, x30, [sp, #-80]!\n"
        "stp x0, x1, [sp, #16]\n"
        "stp x2, x3, [sp, #32]\n"
        "stp x4, x5, [sp, #48]\n"
        "stp x6, x7, [sp, #64]\n"
        "bl _vault_should_fail_sync\n"
        "cbnz w0, 1f\n"
        "ldp x0, x1, [sp, #16]\n"
        "ldp x2, x3, [sp, #32]\n"
        "ldp x4, x5, [sp, #48]\n"
        "ldp x6, x7, [sp, #64]\n"
        "ldp x29, x30, [sp], #80\n"
        "b _fcntl\n"
        "1: ldp x29, x30, [sp], #80\n"
        "mov w0, #-1\n"
        "ret\n"
    );
}

static int vault_renameat(int from_fd, const char *from, int to_fd, const char *to) {
    char path[MAXPATHLEN];
    const char *mode = getenv("XIAOK_TEST_FAULT_MODE");
    bool owned = mode && owned_fd(to_fd, path) && strcmp(path, getenv("XIAOK_TEST_FAULT_ROOT")) == 0 && strcmp(to, "auth.json") == 0;
    if (owned && strcmp(mode, "rename") == 0 && !atomic_exchange(&injected, true)) {
        mark(mode, false);
        errno = EIO;
        return -1;
    }
    int result = renameat(from_fd, from, to_fd, to);
    if (owned && result == 0) atomic_store(&renamed, true);
    return result;
}

__attribute__((used)) static const struct { const void *replacement; const void *original; }
interpose[] __attribute__((section("__DATA,__interpose"))) = {
    { (const void *)vault_fcntl, (const void *)fcntl },
    { (const void *)vault_fsync, (const void *)fsync },
    { (const void *)vault_renameat, (const void *)renameat },
};
