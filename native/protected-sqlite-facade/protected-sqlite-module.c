#include "protected-sqlite-facade.h"
/* No JS opener. A fixed original Native producer must call the C-only factory
 * in this same module instance. The component test factory is a different file. */
static napi_value initialize(napi_env env, napi_value exports) {
  return ps_addon_exports(env, exports);
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
