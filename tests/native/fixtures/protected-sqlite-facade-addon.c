#include "installed-main-client.h"
#include "protected-sqlite-facade.h"
#include <stdlib.h>
#if !defined(MI_FIXTURE_BUILD) || !defined(NR_ROOT_IO_COMPONENT) || !defined(PS_COMPONENT_BUILD)
#error "This factory is a component fixture only"
#endif
static nm_installed_client *client;
static napi_ref original;
static napi_value error(napi_env e, const char *m) {
  napi_throw_error(e, "PS_COMPONENT", m);
  return NULL;
}
static int member(napi_env e, napi_callback_info i, napi_value *out) {
  size_t n = 1;
  napi_value a[1], v;
  bool same = false;
  if (!original || napi_get_cb_info(e, i, &n, a, NULL, NULL) != napi_ok || n != 1 ||
      napi_get_reference_value(e, original, &v) != napi_ok ||
      napi_strict_equals(e, v, a[0], &same) != napi_ok || !same)
    return 0;
  *out = v;
  return 1;
}
static napi_value open_component(napi_env e, napi_callback_info i) {
  (void)i;
  if (client)
    return error(e, "once");
  client = nm_installed_create();
  nr_root_store_io *io = NULL;
  nr_root_store_identity id;
  const nr_root_bootstrap_claim *claim = NULL;
  if (!client || !nm_installed_connect(client) ||
      !nr_component_borrow_original_root_store(client, &io) ||
      !nr_root_store_read_identity(io, &id) ||
      (id.birth_state == NR_CREATED && !nr_root_store_claim_fresh(io, &claim)))
    return error(e, "original RootIO required");
  napi_value core = ps_create_original_namespace(e, io);
  if (!core || napi_create_reference(e, core, 1, &original) != napi_ok)
    return NULL;
  return core;
}
static napi_value finish(napi_env e, napi_callback_info i) {
  napi_value core;
  if (!member(e, i, &core))
    return error(e, "member");
  if (!nm_installed_close_owned(client))
    return error(e, "owned close unconfirmed");
  nm_installed_fate f = {0};
  if (!nm_installed_fate_read(client, &f))
    return error(e, "fate");
  napi_value o, b;
  napi_create_object(e, &o);
  napi_get_boolean(e, f.unknown != 0, &b);
  napi_property_descriptor d[] = {
      {.utf8name = "unknown", .value = b, .attributes = napi_enumerable}};
  napi_define_properties(e, o, 1, d);
  napi_get_boolean(e, f.root_files_closed != 0, &b);
  napi_property_descriptor c[] = {
      {.utf8name = "rootFilesClosed", .value = b, .attributes = napi_enumerable}};
  napi_define_properties(e, o, 1, c);
  return o;
}
static napi_value read_fate(napi_env e, napi_callback_info i) {
  napi_value core;
  nm_installed_fate f = {0};
  if (!member(e, i, &core) || !nm_installed_fate_read(client, &f))
    return error(e, "original component fate required");
  napi_value out, value;
  napi_create_object(e, &out);
  napi_get_boolean(e, f.unknown != 0, &value);
  napi_property_descriptor unknown = {
      .utf8name = "unknown", .value = value, .attributes = napi_enumerable};
  napi_define_properties(e, out, 1, &unknown);
  napi_get_boolean(e, f.root_files_closed != 0, &value);
  napi_property_descriptor closed = {
      .utf8name = "rootFilesClosed", .value = value, .attributes = napi_enumerable};
  napi_define_properties(e, out, 1, &closed);
  napi_create_double(e, (double)f.root_sequence, &value);
  napi_property_descriptor sequence = {
      .utf8name = "rootSequence", .value = value, .attributes = napi_enumerable};
  napi_define_properties(e, out, 1, &sequence);
  return out;
}
static napi_value init(napi_env e, napi_value exports) {
  ps_addon_exports(e, exports);
  napi_property_descriptor d[] = {
      {.utf8name = "openOriginalRootIoComponent", .method = open_component},
      {.utf8name = "finishOriginalComponent", .method = finish},
      {.utf8name = "readOriginalComponentFate", .method = read_fate}};
  napi_define_properties(e, exports, 3, d);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
