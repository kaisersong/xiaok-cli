/* Test TU only: actual child producer body, forced platform fact, no IO role. */
#include <stdio.h>
#include "../../../native/protected-sqlite-facade/protected-sqlite-facade.h"
#include "../../../native/root-resource-authority/installed-main-client.h"
static __attribute__((unused)) nm_installed_client *fixture_create(void) {
  fputs("FIXTURE_NATIVE_CREATE_ENTERED\n", stderr);
  return NULL;
}
#define ps_sqlite_api_available() 0
#define nm_installed_create fixture_create
#if defined(FIXTURE_BROKER_API)
#include "../../../native/broker-authority-source/broker-child-addon.c"
#else
#include "../../../native/kswarm-authority-source/kswarm-child-addon.c"
#endif
