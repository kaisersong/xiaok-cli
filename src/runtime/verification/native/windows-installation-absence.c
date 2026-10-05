#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shlobj.h>
#include <knownfolders.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "windows-absence-core.h"

/* Read-only helper: no argv, environment path, HKCU, registry write or process
 * creation. ProgramData comes from the actual Windows Known Folder API. */
static int plain_directory(const wchar_t *path) {
  HANDLE handle = CreateFileW(path, FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  BY_HANDLE_FILE_INFORMATION info;
  int valid;
  if (handle == INVALID_HANDLE_VALUE) return 0;
  valid = GetFileInformationByHandle(handle, &info) &&
      (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) &&
      !(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT);
  CloseHandle(handle);
  return valid;
}

static int directory_fact(void) {
  PWSTR known = NULL;
  wchar_t *path = NULL;
  size_t length, i;
  int result = XIAOK_UNKNOWN;
  DWORD attributes, error;
  if (FAILED(SHGetKnownFolderPath(&FOLDERID_ProgramData, 0, NULL, &known)) || !known)
    goto done;
  length = wcslen(known);
  if (length < 3 || length > 32000 || known[1] != L':' || known[2] != L'\\' ||
      !((known[0] >= L'A' && known[0] <= L'Z') || (known[0] >= L'a' && known[0] <= L'z')))
    goto done;
  path = (wchar_t *)calloc(length + 64, sizeof(wchar_t));
  if (!path) goto done;
  memcpy(path, known, (length + 1) * sizeof(wchar_t));
  path[3] = L'\0';
  if (GetDriveTypeW(path) != DRIVE_FIXED || !plain_directory(path)) goto done;
  memcpy(path, known, (length + 1) * sizeof(wchar_t));
  for (i = 3; i <= length; ++i) {
    if (i == length || path[i] == L'\\') {
      wchar_t saved = path[i];
      path[i] = L'\0';
      if (!plain_directory(path)) goto done;
      path[i] = saved;
    }
    if (path[i] == L'/') goto done;
  }
  if (wcscat_s(path, length + 64, L"\\xiaok-verification") != 0) goto done;
  attributes = GetFileAttributesW(path);
  if (attributes != INVALID_FILE_ATTRIBUTES) result = XIAOK_PRESENT;
  else {
    error = GetLastError();
    if (error == ERROR_FILE_NOT_FOUND) result = XIAOK_ABSENT;
    /* ERROR_PATH_NOT_FOUND is unknown: the validated parent disappeared. */
  }
done:
  free(path);
  if (known) CoTaskMemFree(known);
  return result;
}

static int plain_key(HKEY key) {
  DWORD type = 0;
  LSTATUS status = RegQueryValueExW(key, L"SymbolicLinkValue", NULL, &type, NULL, NULL);
  return status == ERROR_FILE_NOT_FOUND;
}

static int registry_fact(void) {
  HKEY software = NULL, xiaok = NULL, verification = NULL;
  LSTATUS status;
  int result = XIAOK_UNKNOWN;
  status = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE", REG_OPTION_OPEN_LINK,
      KEY_READ | KEY_WOW64_64KEY, &software);
  if (status != ERROR_SUCCESS || !plain_key(software)) goto done;
  status = RegOpenKeyExW(software, L"Xiaok", REG_OPTION_OPEN_LINK,
      KEY_READ | KEY_WOW64_64KEY, &xiaok);
  if (status == ERROR_FILE_NOT_FOUND) { result = XIAOK_ABSENT; goto done; }
  if (status != ERROR_SUCCESS || !plain_key(xiaok)) goto done;
  status = RegOpenKeyExW(xiaok, L"Verification", REG_OPTION_OPEN_LINK,
      KEY_READ | KEY_WOW64_64KEY, &verification);
  if (status == ERROR_SUCCESS) result = XIAOK_PRESENT;
  else if (status == ERROR_FILE_NOT_FOUND) result = XIAOK_ABSENT;
done:
  if (verification) RegCloseKey(verification);
  if (xiaok) RegCloseKey(xiaok);
  if (software) RegCloseKey(software);
  return result;
}

int wmain(int argc, wchar_t **argv) {
  int directory1, registry1, directory2, registry2, result;
  (void)argv;
  if (argc != 1) { puts("{\"version\":1,\"kind\":\"unavailable\"}"); return 64; }
  directory1 = directory_fact(); registry1 = registry_fact();
  directory2 = directory_fact(); registry2 = registry_fact();
  result = xiaok_absence_result(directory1, registry1, directory2, registry2);
  puts(result == XIAOK_ABSENT ? "{\"version\":1,\"kind\":\"ordinary\"}" :
       result == XIAOK_PRESENT ? "{\"version\":1,\"kind\":\"installed\"}" :
       "{\"version\":1,\"kind\":\"unavailable\"}");
  return 0;
}
