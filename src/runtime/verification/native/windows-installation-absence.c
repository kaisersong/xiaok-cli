#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include "windows-installation-absence-core.h"

/* Fixed machine KnownFolder; never locate it through environment variables. */
static const GUID program_data = {
    0x62ab5d82, 0xfdc1, 0x4dc3,
    {0xa9, 0xdd, 0x07, 0x0d, 0x1d, 0x49, 0x5d, 0x97}
};

static int probe_directory(const wchar_t *target) {
    HANDLE handle = CreateFileW(target, FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
        OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    if (handle != INVALID_HANDLE_VALUE) {
        CloseHandle(handle);
        return 1; /* Any object, including a reparse point, denies ordinary. */
    }
    return GetLastError() == ERROR_FILE_NOT_FOUND ? 0 : 2;
}

static int probe_registry(void) {
    HKEY software = NULL, verification = NULL;
    const REGSAM access = KEY_READ | KEY_WOW64_64KEY;
    LSTATUS status = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE", 0, access, &software);
    if (status != ERROR_SUCCESS) return 2;
    status = RegOpenKeyExW(software, L"Xiaok\\Verification", 0, access, &verification);
    if (verification != NULL) RegCloseKey(verification);
    RegCloseKey(software);
    if (status == ERROR_SUCCESS) return 1;
    return status == ERROR_FILE_NOT_FOUND ? 0 : 2;
}

static int same_parent(const BY_HANDLE_FILE_INFORMATION *a,
                       const BY_HANDLE_FILE_INFORMATION *b) {
    return a->dwVolumeSerialNumber == b->dwVolumeSerialNumber &&
        a->nFileIndexHigh == b->nFileIndexHigh && a->nFileIndexLow == b->nFileIndexLow &&
        a->dwFileAttributes == b->dwFileAttributes;
}

static int query_absence(void) {
    PWSTR parent = NULL, second_parent = NULL;
    wchar_t *target = NULL;
    HANDLE parent_handle = INVALID_HANDLE_VALUE;
    BY_HANDLE_FILE_INFORMATION before, after;
    int result = 2;
    HRESULT initialized = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) return 2;
    if (FAILED(SHGetKnownFolderPath(&program_data, 0, NULL, &parent)) || parent == NULL) goto done;
    /* No delete sharing: keep the real parent in place during both probes. */
    parent_handle = CreateFileW(parent, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    if (parent_handle == INVALID_HANDLE_VALUE ||
        !GetFileInformationByHandle(parent_handle, &before) ||
        !(before.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
        (before.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) goto done;
    size_t length = wcslen(parent);
    if (length == 0 || length > 32000) goto done;
    target = calloc(length + 32, sizeof(wchar_t));
    if (target == NULL) goto done;
    wcscpy(target, parent);
    wcscat(target, L"\\xiaok-verification");
    int db = probe_directory(target), rb = probe_registry();
    int da = probe_directory(target), ra = probe_registry();
    if (FAILED(SHGetKnownFolderPath(&program_data, 0, NULL, &second_parent)) ||
        second_parent == NULL || _wcsicmp(parent, second_parent) != 0 ||
        !GetFileInformationByHandle(parent_handle, &after) || !same_parent(&before, &after)) goto done;
    result = xiaok_absence_result(db, rb, da, ra);
done:
    if (parent_handle != INVALID_HANDLE_VALUE) CloseHandle(parent_handle);
    if (parent != NULL) CoTaskMemFree(parent);
    if (second_parent != NULL) CoTaskMemFree(second_parent);
    free(target);
    CoUninitialize();
    return result;
}

int main(int argc, char **argv) {
    (void)argv;
    if (argc != 1) {
        puts("{\"version\":1,\"kind\":\"unavailable\"}");
        return 2;
    }
    const int result = query_absence();
    const char *kind = result == 0 ? "ordinary" : result == 1 ? "installed" : "unavailable";
    printf("{\"version\":1,\"kind\":\"%s\"}\n", kind);
    return 0;
}
