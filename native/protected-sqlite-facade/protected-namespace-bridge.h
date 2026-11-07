#ifndef XIAOK_ORIGINAL_PROTECTED_NAMESPACE_BRIDGE_H
#define XIAOK_ORIGINAL_PROTECTED_NAMESPACE_BRIDGE_H
#include <v8.h>
#include "../root-resource-authority/root-store-io.h"
/* Native only; the fixed producer must have privately imported genuine IO.
 * Same module NAPI environment, one-shot slot, no JS pointer/registration. */
v8::MaybeLocal<v8::Value> nr_create_original_protected_namespace(v8::Local<v8::Context>,nr_root_store_io *);
#ifdef NR_ADMISSION_NAMESPACE_BRIDGE
void nr_install_admission_namespace_exports(v8::Local<v8::Context>,v8::Local<v8::Object>);
#endif
#endif
