#include <node_api.h>
#include <stdlib.h>
#ifdef _WIN32
#include <windows.h>
typedef struct { HANDLE handle; } owner_lock;
static void unlock(owner_lock *lock) {
  if (lock->handle != INVALID_HANDLE_VALUE) { CloseHandle(lock->handle); lock->handle = INVALID_HANDLE_VALUE; }
}
#else
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
typedef struct { int fd; } owner_lock;
static void unlock(owner_lock *lock) {
  if (lock->fd >= 0) { close(lock->fd); lock->fd = -1; }
}
#endif

static void finalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint; owner_lock *lock = data; unlock(lock); free(lock);
}
static napi_value fail(napi_env env, const char *code) { napi_throw_error(env, NULL, code); return NULL; }
static napi_value acquire(napi_env env, napi_callback_info info) {
  size_t argc = 1, length = 0; napi_value arg;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_string_utf8(env, arg, NULL, 0, &length) != napi_ok || length == 0 || length > 32768)
    return fail(env, "owner_lock_unavailable");
  char *path = malloc(length + 1); owner_lock *lock = malloc(sizeof(owner_lock));
  if (!path || !lock) { free(path); free(lock); return fail(env, "owner_lock_unavailable"); }
  if (napi_get_value_string_utf8(env, arg, path, length + 1, &length) != napi_ok) {
    free(path); free(lock); return fail(env, "owner_lock_unavailable");
  }
#ifdef _WIN32
  int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
  wchar_t *wide = count > 0 ? malloc((size_t)count * sizeof(wchar_t)) : NULL;
  if (!wide) { free(path); free(lock); return fail(env, "owner_lock_unavailable"); }
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide, count);
  lock->handle = CreateFileW(wide, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
    NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  free(wide); free(path);
  if (lock->handle == INVALID_HANDLE_VALUE) { free(lock); return fail(env, "owner_lock_unavailable"); }
  BY_HANDLE_FILE_INFORMATION file_info;
  OVERLAPPED overlap = {0};
  if (!GetFileInformationByHandle(lock->handle, &file_info) ||
      (file_info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) {
    unlock(lock); free(lock); return fail(env, "owner_lock_unavailable");
  }
  if (!LockFileEx(lock->handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlap)) {
    DWORD error = GetLastError(); unlock(lock); free(lock);
    return fail(env, error == ERROR_LOCK_VIOLATION ? "owner_lock_busy" : "owner_lock_unavailable");
  }
#else
  lock->fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600); free(path);
  if (lock->fd < 0) { free(lock); return fail(env, "owner_lock_unavailable"); }
  struct stat file_info;
  if (fstat(lock->fd, &file_info) != 0 || !S_ISREG(file_info.st_mode)) {
    unlock(lock); free(lock); return fail(env, "owner_lock_unavailable");
  }
  if (flock(lock->fd, LOCK_EX | LOCK_NB) != 0) {
    int error = errno; unlock(lock); free(lock);
    return fail(env, error == EWOULDBLOCK || error == EAGAIN ? "owner_lock_busy" : "owner_lock_unavailable");
  }
#endif
  napi_value result;
  if (napi_create_external(env, lock, finalize, NULL, &result) != napi_ok) {
    unlock(lock); free(lock); return fail(env, "owner_lock_unavailable");
  }
  return result;
}
static napi_value release(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value arg, result; owner_lock *lock;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_external(env, arg, (void **)&lock) != napi_ok) return fail(env, "owner_lock_unavailable");
  unlock(lock); napi_get_undefined(env, &result); return result;
}
NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "acquire", NAPI_AUTO_LENGTH, acquire, NULL, &fn);
  napi_set_named_property(env, exports, "acquire", fn);
  napi_create_function(env, "release", NAPI_AUTO_LENGTH, release, NULL, &fn);
  napi_set_named_property(env, exports, "release", fn);
  return exports;
}
