/* Actual client TU with only its platform fact forced unsupported. */
#include "../../../native/protected-sqlite-facade/sqlite-api-availability.h"
#define ps_sqlite_api_available() 0
#include "../../../native/root-resource-authority/installed-main-client.c"
