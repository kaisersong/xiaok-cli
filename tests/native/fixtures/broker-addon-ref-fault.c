#include <node_api.h>
static napi_status original_reference_fault(napi_env env,napi_value value,uint32_t count,napi_ref *out){(void)env;(void)value;(void)count;(void)out;return napi_generic_failure;}
#define napi_create_reference original_reference_fault
#include "../../../native/broker-authority-source/broker-child-addon.c"
