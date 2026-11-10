#ifndef NR_MAIN_SESSION_BRIDGE_H
#define NR_MAIN_SESSION_BRIDGE_H
#include <node_api.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct nr_main_bridge nr_main_bridge;
typedef enum {
 NR_MAIN_OK, NR_MAIN_ROLE_UNAVAILABLE, NR_MAIN_ALREADY_ATTEMPTED,
 NR_MAIN_UNCONFIRMED, NR_MAIN_EXCEPTION_PENDING, NR_MAIN_REVOKED,
 NR_MAIN_CONTEXT_REQUIRED
} nr_main_result;
nr_main_bridge *nr_main_bridge_create(napi_env env,const void *private_cookie);
nr_main_result nr_main_bridge_birth(nr_main_bridge *,napi_env,const void *);
nr_main_result nr_main_bridge_current(nr_main_bridge *,napi_env,const void *);
void nr_main_bridge_revoke(nr_main_bridge *,napi_env,const void *);
void nr_main_bridge_retain(nr_main_bridge *);
void nr_main_bridge_release(nr_main_bridge *);
void nr_main_bridge_env_close(nr_main_bridge *);
nr_main_result nr_main_bridge_adoption_enter(nr_main_bridge *,napi_env,const void *,uint64_t *);
nr_main_result nr_main_bridge_adoption_leave(nr_main_bridge *,napi_env,const void *,uint64_t);
/* Installation adoption is performed through the module-born fixed C++
 * function and a target-DSO private one-shot call slot. This bridge keeps the
 * same borrowed native client; it never consumes another seed or copies keys.
 * Borrow release precedes destination teardown; producer capsules outlive
 * either Environment cleanup order. No JS vtable/validator is accepted. */
/* Sole embedded C method registration, invoked by the original Node SDK. */
napi_value nr_init_resource_authority(napi_env,napi_value);
#ifdef __cplusplus
}
#endif
#endif
