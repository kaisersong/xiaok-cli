#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0600
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include "windows-installation-absence-core.h"

/* Read-only machine observations, never a controller qualification receipt. */
static const GUID program_data = {
    0x62ab5d82, 0xfdc1, 0x4dc3,
    {0xa9, 0xdd, 0x07, 0x0d, 0x1d, 0x49, 0x5d, 0x97}
};
typedef struct {
    HANDLE handle;
    BY_HANDLE_FILE_INFORMATION identity;
} ancestor;

static int same_identity(const BY_HANDLE_FILE_INFORMATION *a,
                         const BY_HANDLE_FILE_INFORMATION *b) {
    return a->dwVolumeSerialNumber == b->dwVolumeSerialNumber &&
        a->nFileIndexHigh == b->nFileIndexHigh && a->nFileIndexLow == b->nFileIndexLow &&
        a->dwFileAttributes == b->dwFileAttributes;
}
static int plain_directory(const BY_HANDLE_FILE_INFORMATION *info) {
    return (info->dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) &&
        !(info->dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT);
}
static HANDLE open_ancestor(const wchar_t *path) {
    return CreateFileW(path, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
}
static int local_path(const wchar_t *path, size_t *length) {
    size_t n = 0, start = 3;
    while (n <= 32000 && path[n] != L'\0') n++;
    if (n < 3 || n > 32000 ||
        !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) ||
        path[1] != L':' || path[2] != L'\\') return 0;
    for (size_t i = 3; i <= n; i++) {
        if (path[i] == L'/' || path[i] == L':') return 0;
        if (path[i] == L'\\' || i == n) {
            size_t segment = i - start;
            if (segment == 0 && n != 3) return 0;
            if ((segment == 1 && path[start] == L'.') ||
                (segment == 2 && path[start] == L'.' && path[start + 1] == L'.')) return 0;
            start = i + 1;
        }
    }
    *length = n;
    return 1;
}
static int probe_directory(const wchar_t *path) {
    HANDLE handle = CreateFileW(path, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    if (handle != INVALID_HANDLE_VALUE) {
        CloseHandle(handle);
        return 1; /* Any object, including a link, denies ordinary. */
    }
    return GetLastError() == ERROR_FILE_NOT_FOUND ? 0 : 2;
}
static int plain_registry_key(HKEY key) {
    DWORD type = 0, size = 0;
    /* Any value/type or query failure is unknown; never follow a registry link. */
    return RegQueryValueExW(key, L"SymbolicLinkValue", NULL, &type, NULL, &size) == ERROR_FILE_NOT_FOUND;
}
static int probe_registry(void) {
    HKEY software = NULL, xiaok = NULL, verification = NULL;
    const REGSAM access = KEY_READ | KEY_WOW64_64KEY;
    LSTATUS status;
    int result = 2;
    status = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE", REG_OPTION_OPEN_LINK, access, &software);
    if (status != ERROR_SUCCESS || !plain_registry_key(software)) goto done;
    status = RegOpenKeyExW(software, L"Xiaok", REG_OPTION_OPEN_LINK, access, &xiaok);
    if (status == ERROR_FILE_NOT_FOUND) { result = 0; goto done; }
    if (status != ERROR_SUCCESS || !plain_registry_key(xiaok)) goto done;
    status = RegOpenKeyExW(xiaok, L"Verification", REG_OPTION_OPEN_LINK, access, &verification);
    if (status == ERROR_SUCCESS) result = 1; /* Plain and link keys both count. */
    else if (status == ERROR_FILE_NOT_FOUND) result = 0;
done:
    if (verification != NULL) RegCloseKey(verification);
    if (xiaok != NULL) RegCloseKey(xiaok);
    if (software != NULL) RegCloseKey(software);
    return result;
}
static int query_absence(void) {
    PWSTR parent = NULL, second_parent = NULL;
    wchar_t *buffer = NULL;
    ancestor *held = NULL;
    size_t *lengths = NULL;
    size_t length = 0, count = 0, acquired = 0;
    wchar_t drive[4];
    int result = 2;
    HRESULT initialized = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) return 2;
    if (FAILED(SHGetKnownFolderPath(&program_data, 0, NULL, &parent)) || parent == NULL ||
        !local_path(parent, &length)) goto done;
    drive[0] = parent[0]; drive[1] = L':'; drive[2] = L'\\'; drive[3] = L'\0';
    if (GetDriveTypeW(drive) != DRIVE_FIXED) goto done;
    buffer = calloc(length + 32, sizeof(wchar_t));
    held = calloc(length + 1, sizeof(ancestor));
    lengths = calloc(length + 1, sizeof(size_t));
    if (buffer == NULL || held == NULL || lengths == NULL) goto done;
    lengths[count++] = 3;
    for (size_t i = 3; i < length; i++) if (parent[i] == L'\\') lengths[count++] = i;
    if (length > 3) lengths[count++] = length;
    wcscpy(buffer, parent);
    for (size_t i = 0; i < count; i++) {
        wchar_t saved = buffer[lengths[i]];
        buffer[lengths[i]] = L'\0';
        HANDLE handle = open_ancestor(buffer);
        buffer[lengths[i]] = saved;
        if (handle == INVALID_HANDLE_VALUE) goto done;
        held[i].handle = handle; acquired++;
        if (!GetFileInformationByHandle(handle, &held[i].identity) ||
            !plain_directory(&held[i].identity)) goto done;
    }
    wcscat(buffer, length == 3 ? L"xiaok-verification" : L"\\xiaok-verification");
    int db = probe_directory(buffer), rb = probe_registry();
    int da = probe_directory(buffer), ra = probe_registry();
    /* Final checks occur after all four independent observations while every
       original ancestor remains held, including during fresh path reopens. */
    if (FAILED(SHGetKnownFolderPath(&program_data, 0, NULL, &second_parent)) ||
        second_parent == NULL || _wcsicmp(parent, second_parent) != 0 ||
        GetDriveTypeW(drive) != DRIVE_FIXED) goto done;
    wcscpy(buffer, parent);
    for (size_t i = 0; i < count; i++) {
        BY_HANDLE_FILE_INFORMATION current, fresh;
        if (!GetFileInformationByHandle(held[i].handle, &current) ||
            !plain_directory(&current) || !same_identity(&held[i].identity, &current)) goto done;
        wchar_t saved = buffer[lengths[i]];
        buffer[lengths[i]] = L'\0';
        HANDLE reopened = open_ancestor(buffer);
        buffer[lengths[i]] = saved;
        if (reopened == INVALID_HANDLE_VALUE) goto done;
        int valid = GetFileInformationByHandle(reopened, &fresh) &&
            plain_directory(&fresh) && same_identity(&held[i].identity, &fresh);
        CloseHandle(reopened);
        if (!valid) goto done;
    }
    result = xiaok_absence_result(db, rb, da, ra);
done:
    for (size_t i = 0; i < acquired; i++) CloseHandle(held[i].handle);
    free(lengths); free(held); free(buffer);
    if (second_parent != NULL) CoTaskMemFree(second_parent);
    if (parent != NULL) CoTaskMemFree(parent);
    CoUninitialize();
    return result;
}
int main(int argc, char **argv) {
    (void)argv;
    if (argc != 1) { puts("{\"version\":1,\"kind\":\"unavailable\"}"); return 2; }
    const int result = query_absence();
    const char *kind = result == 0 ? "ordinary" : result == 1 ? "installed" : "unavailable";
    printf("{\"version\":1,\"kind\":\"%s\"}\n", kind);
    return 0;
}
