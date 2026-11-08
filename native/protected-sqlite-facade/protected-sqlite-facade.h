#ifndef XIAOK_PROTECTED_SQLITE_FACADE_H
#define XIAOK_PROTECTED_SQLITE_FACADE_H
#include "root-store-io.h"
#include "sqlite-api-availability.h"
#include <node_api.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Original C producer only. No JS path, external pointer, fd or verifier. */
napi_value ps_create_original_namespace(napi_env, nr_root_store_io *);
napi_value ps_addon_exports(napi_env, napi_value);
#ifdef __cplusplus
}
#endif
#endif
