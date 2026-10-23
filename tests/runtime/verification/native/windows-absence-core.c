#include <assert.h>
#include "../../../../src/runtime/verification/native/windows-absence-core.h"
int main(void) {
  assert(xiaok_absence_result(0, 0, 0, 0) == XIAOK_ABSENT);
  assert(xiaok_absence_result(0, 0, 1, 0) == XIAOK_PRESENT);
  assert(xiaok_absence_result(0, 1, 0, 0) == XIAOK_PRESENT);
  assert(xiaok_absence_result(-1, 0, 0, 0) == XIAOK_UNKNOWN);
  assert(xiaok_absence_result(0, 0, 0, -1) == XIAOK_UNKNOWN);
  assert(xiaok_absence_result(7, 0, 0, 0) == XIAOK_UNKNOWN);
  return 0;
}
