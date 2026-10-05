#ifndef XIAOK_WINDOWS_ABSENCE_CORE_H
#define XIAOK_WINDOWS_ABSENCE_CORE_H
enum xiaok_absence_fact { XIAOK_UNKNOWN = -1, XIAOK_ABSENT = 0, XIAOK_PRESENT = 1 };
/* Repeated observations are not an atomic installation snapshot. An installer
 * must first durably publish its machine pending marker and retain it. */
static inline int xiaok_absence_result(int directory1, int registry1,
                                     int directory2, int registry2) {
  const int facts[4] = {directory1, registry1, directory2, registry2};
  int i;
  for (i = 0; i < 4; ++i)
    if (facts[i] != XIAOK_ABSENT && facts[i] != XIAOK_PRESENT)
      return XIAOK_UNKNOWN;
  for (i = 0; i < 4; ++i)
    if (facts[i] == XIAOK_PRESENT) return XIAOK_PRESENT;
  return XIAOK_ABSENT;
}
#endif
