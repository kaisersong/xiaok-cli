#ifndef XIAOK_WINDOWS_ABSENCE_CORE_H
#define XIAOK_WINDOWS_ABSENCE_CORE_H
/* 0: explicitly absent; 1: installation evidence; 2: unknown. */
static int xiaok_absence_result(int directory_before, int registry_before,
                               int directory_after, int registry_after) {
    if (directory_before == 1 || registry_before == 1 ||
        directory_after == 1 || registry_after == 1) return 1;
    if (directory_before == 0 && registry_before == 0 &&
        directory_after == 0 && registry_after == 0) return 0;
    return 2;
}
#endif
