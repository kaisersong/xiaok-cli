#include <node.h>
#include <v8.h>
#include "protected-namespace-bridge.h"
#include "installed-main-handoff.h"
#include "root-store-io-dispatch.h"
#include "../main-installation/protocol.h"

namespace {
v8::Local<v8::String> text(v8::Isolate* isolate, const char* value) {
  return v8::String::NewFromUtf8(isolate, value).ToLocalChecked();
}
void deny(v8::Isolate* isolate, const char* message) {
  isolate->ThrowException(v8::Exception::Error(text(isolate, message)));
}
void prepare(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  auto context = isolate->GetCurrentContext();
  auto* environment = node::GetCurrentEnvironment(context);
  // Only an original native issuer carries this private capsule. No caller
  // path, family, digest, callback or environment claim is accepted here.
  if (args.Length() != 1 || !environment || !args[0]->IsObject() || args[0]->IsProxy())
    return deny(isolate, "ORIGINAL_ADMISSION_CORE_REQUIRED");
  v8::Local<v8::Value> hidden;
  if (!args[0].As<v8::Object>()->GetPrivate(context,
        v8::Private::ForApi(isolate, text(isolate, NM_HANDOFF_PRIVATE))).ToLocal(&hidden) ||
      !hidden->IsExternal())
    return deny(isolate, "ORIGINAL_ADMISSION_CORE_REQUIRED");
  auto* table = static_cast<const nm_installation_handoff*>(hidden.As<v8::External>()->Value());
  if (!table || table->magic != NM_HANDOFF_MAGIC || table->version != NM_HANDOFF_VERSION ||
      table->size != sizeof(*table) || table->build_kind != MI_BUILD_KIND ||
      !table->prepare_admission_store || !table->root_store_ops)
    return deny(isolate, "ORIGINAL_ADMISSION_CORE_REQUIRED");
  v8::Local<v8::Value> original = args[0];
  nr_root_store_io* io = nullptr;
  if (!table->prepare_admission_store(table, &original, environment, &io) || !io)
    return deny(isolate, "ORIGINAL_ADMISSION_CORE_UNCONFIRMED");
  // Each DSO checks its own original IO registry. Cross-DSO adoption uses the
  // original producer's fixed dispatch table, never a JavaScript registrar.
  if (table->root_store_ops != nm_installed_root_store_dispatch() &&
      !nm_installed_import_root_store(table->root_store_ops, io))
    return deny(isolate, "ORIGINAL_ADMISSION_IO_UNCONFIRMED");
  v8::Local<v8::Value> result;
  if (nr_create_original_protected_namespace(context, io).ToLocal(&result))
    args.GetReturnValue().Set(result);
  // A failed accepted birth retains its original Native file-family hold.
}
}  // namespace

void nr_install_admission_namespace_exports(v8::Local<v8::Context> context,
                                           v8::Local<v8::Object> exports) {
  v8::Local<v8::Function> function;
  if (v8::Function::New(context, prepare).ToLocal(&function))
    (void)exports->CreateDataProperty(context,
      text(v8::Isolate::GetCurrent(), "prepareOriginalAdmissionNamespace"), function);
}
