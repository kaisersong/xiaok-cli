/* Same original translation unit, exact contiguous function group. Not a public header. */
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
struct nr_main_bridge {
  nr_main_bridge* next;
  MainState* state;
  napi_env api_env;
  const void* cookie;
  uv_loop_t* napi_loop;
  unsigned references;
  const nm_installation_handoff* installation;
  nr_root_store_io* root_store;
  const nm_installation_handoff* root_store_lifetime;
};
static thread_local nr_main_bridge* bridges;
static bool BridgeMember(nr_main_bridge* value) {
  for(auto* row=bridges;row;row=row->next)if(row==value)return true;
  return false;
}
static bool BridgeIdentity(nr_main_bridge* value,napi_env env,const void* cookie) {
  return BridgeMember(value)&&value->api_env==env&&value->cookie==cookie;
}
struct InstallationCall {
  nr_main_bridge* bridge;napi_env env;const void* cookie;uint64_t serial;
};
static thread_local InstallationCall* active_adoption;
static thread_local InstallationCall* pending_adoption;
static thread_local uint64_t adoption_serial;
extern "C" nr_main_result nr_main_bridge_adoption_enter(nr_main_bridge* bridge,napi_env env,const void* cookie,uint64_t* serial){
  if(!serial||active_adoption||!BridgeIdentity(bridge,env,cookie)||!SameContext(bridge->state)||bridge->references==UINT_MAX||adoption_serial==UINT64_MAX)return NR_MAIN_UNCONFIRMED;
  auto* call=new(std::nothrow) InstallationCall{bridge,env,cookie,adoption_serial+1};
  if(!call)return NR_MAIN_UNCONFIRMED;
  ++bridge->references;adoption_serial=call->serial;
  active_adoption=call;pending_adoption=call;*serial=call->serial;return NR_MAIN_OK;
}
extern "C" nr_main_result nr_main_bridge_adoption_leave(nr_main_bridge* bridge,napi_env env,const void* cookie,uint64_t serial){
  auto* call=active_adoption;
  if(!call||!BridgeIdentity(bridge,env,cookie)||call->bridge!=bridge||call->env!=env||call->cookie!=cookie||call->serial!=serial)return NR_MAIN_UNCONFIRMED;
  if(pending_adoption&&pending_adoption!=call)return NR_MAIN_UNCONFIRMED;
  if(pending_adoption==call)pending_adoption=nullptr;
  active_adoption=nullptr;delete call;nr_main_bridge_release(bridge);return NR_MAIN_OK;
}
static InstallationCall* TakeInstallationCall(){
  auto* call=pending_adoption;pending_adoption=nullptr;
  return call&&active_adoption==call?call:nullptr;
}
extern "C" nr_main_bridge* nr_main_bridge_create(napi_env env,const void* cookie) {
  if(!cookie)return nullptr;
  auto* isolate=v8::Isolate::GetCurrent();
  if(!isolate)return nullptr;
  uv_loop_t* loop=nullptr;
  if(napi_get_uv_event_loop(env,&loop)!=napi_ok||!loop)return nullptr;
  auto* state=NewState(isolate->GetCurrentContext());
  if(!state)return nullptr;
  auto* bridge=new(std::nothrow) nr_main_bridge{bridges,state,env,cookie,loop,1,nullptr,nullptr,nullptr};
  if(!bridge){Cleanup(state);return nullptr;}
  bridges=bridge;return bridge;
}
extern "C" nr_main_result nr_main_bridge_birth(nr_main_bridge* bridge,napi_env env,const void* cookie) {
  if(!BridgeIdentity(bridge,env,cookie))return NR_MAIN_UNCONFIRMED;
  auto* state=bridge->state;
  if(!SameContext(state))return NR_MAIN_CONTEXT_REQUIRED;
  if(state->attempted)return NR_MAIN_ALREADY_ATTEMPTED;
  state->attempted=true;
  if(bridge->napi_loop!=state->loop||!MainPrecheck(state)){
    state->failed=true;return NR_MAIN_ROLE_UNAVAILABLE;
  }
  v8::Local<v8::Object> unused;
  if(!BuildIssuer(state).ToLocal(&unused)){
    state->isolate->ThrowException(state->failure.Get(state->isolate));
    return NR_MAIN_EXCEPTION_PENDING;
  }
  return NR_MAIN_OK;
}
extern "C" nr_main_result nr_main_bridge_current(nr_main_bridge* bridge,napi_env env,const void* cookie) {
  if(!BridgeIdentity(bridge,env,cookie))return NR_MAIN_UNCONFIRMED;
  auto* state=bridge->state;
  if(state->revoked||state->closing)return NR_MAIN_REVOKED;
  if(!SameContext(state))return NR_MAIN_CONTEXT_REQUIRED;
  if(!state->attempted||state->failed||state->app.IsEmpty()||bridge->napi_loop!=state->loop||!MainPrecheck(state)){
    state->failed=true;return NR_MAIN_UNCONFIRMED;
  }
  return NR_MAIN_OK;
}
extern "C" int nr_main_bridge_borrow_root_store(nr_main_bridge* bridge,const void* exact_env,const void* cookie,nr_root_store_io** out){
  if(!out||!BridgeIdentity(bridge,static_cast<napi_env>(const_cast<void*>(exact_env)),cookie)||
     nr_main_bridge_current(bridge,bridge->api_env,cookie)!=NR_MAIN_OK||!bridge->installation)return 0;
  if(bridge->root_store){*out=bridge->root_store;return 1;}
  const auto* table=bridge->installation;
  if(table->version!=NM_HANDOFF_VERSION||table->size!=sizeof(*table)||!table->borrow_root_store||!table->root_store_ops||!table->root_store_close_ready)return 0;
  nr_root_store_io* io=nullptr;
  if(!table->borrow_root_store(table,bridge->state->env,bridge,cookie,&io)||!io||
     !nm_installed_import_root_store(table->root_store_ops,io))return 0;
  bridge->root_store=io;bridge->root_store_lifetime=table;*out=io;return 1;
}
extern "C" int nr_main_bridge_root_store_close_ready(nr_main_bridge* bridge,const void* env,const void* cookie,nr_root_store_io* io){
 if(!BridgeIdentity(bridge,static_cast<napi_env>(const_cast<void*>(env)),cookie)||!io||bridge->root_store!=io||!bridge->root_store_lifetime)return -1;
 const auto* table=bridge->root_store_lifetime;
 return table->root_store_close_ready?table->root_store_close_ready(table,io):-1;
}
extern "C" void nr_main_bridge_revoke(nr_main_bridge* bridge,napi_env env,const void* cookie) {
  if(BridgeIdentity(bridge,env,cookie))bridge->state->revoked=true;
}
extern "C" void nr_main_bridge_retain(nr_main_bridge* bridge) {
  if(BridgeMember(bridge))bridge->references++;
}
static void ReleaseBorrow(nr_main_bridge* bridge){
  if(bridge->installation){const auto* table=bridge->installation;bridge->installation=nullptr;table->release(table,bridge,bridge->cookie);}
}
extern "C" void nr_main_bridge_env_close(nr_main_bridge* bridge) {
  if(BridgeMember(bridge)){ReleaseBorrow(bridge);CloseState(bridge->state);}
}
extern "C" void nr_main_bridge_release(nr_main_bridge* bridge) {
  if(!BridgeMember(bridge)||!bridge->references)return;
  if(--bridge->references)return;
  auto** slot=&bridges;while(*slot&&*slot!=bridge)slot=&(*slot)->next;
  if(*slot)*slot=bridge->next;
  ReleaseBorrow(bridge);Cleanup(bridge->state);delete bridge;
}
// Invoked only through the C addon's module-born captured function. The
// Native call slot is occupied only after the original C membership gate.
void AdoptInstallation(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* isolate=args.GetIsolate();
  auto* call=TakeInstallationCall();
  if(!call)return HandoffFailure(isolate,"HANDOFF_CALL_SLOT_REQUIRED");
  if(args.Length()!=1||!args[0]->IsObject()||args[0]->IsProxy())return HandoffFailure(isolate,"HANDOFF_ARGUMENTS");
  auto* bridge=call->bridge;
  if(!BridgeMember(bridge))return HandoffFailure(isolate,"HANDOFF_DESTINATION_MEMBER");
  if(!BridgeIdentity(bridge,call->env,call->cookie)||!SameContext(bridge->state))return HandoffFailure(isolate,"HANDOFF_DESTINATION_IDENTITY");
  if(!MainPrecheck(bridge->state))return HandoffFailure(isolate,"HANDOFF_DESTINATION_MAIN_ROLE");
  if(bridge->state->failed||bridge->state->revoked)return HandoffFailure(isolate,"HANDOFF_DESTINATION_REVOKED");
  v8::Local<v8::Value> hidden;
  if(!args[0].As<v8::Object>()->GetPrivate(isolate->GetCurrentContext(),InstallationPrivate(isolate)).ToLocal(&hidden)||!hidden->IsExternal())return HandoffFailure(isolate,"HANDOFF_SOURCE_CAPSULE");
  const auto* table=static_cast<const nm_installation_handoff*>(hidden.As<v8::External>()->Value());
  if(!table||table->magic!=NM_HANDOFF_MAGIC||table->version!=NM_HANDOFF_VERSION||table->size!=sizeof(*table)||table->build_kind!=MI_BUILD_KIND||!table->borrow||!table->current||!table->ping||!table->release||!table->fate||!table->close_owned||!table->borrow_root_store||!table->root_store_ops||!table->root_store_close_ready)return HandoffFailure(isolate,"HANDOFF_SOURCE_TABLE");
  if(bridge->installation&&bridge->installation!=table)return Throw(isolate,"MAIN_INSTALLATION_ALREADY_ADOPTED");
  const v8::Local<v8::Value> original=args[0];
  if(!table->borrow(table,&original,bridge->state->env,bridge,bridge->cookie))return HandoffFailure(isolate,"HANDOFF_SOURCE_CURRENT");
  bridge->installation=table;
  // Fixed closed PING proves the borrowed object advances the same channels
  // and counters; there is no caller operation/body/MAC selector.
  if(!table->current(table)||!table->ping(table))return Throw(isolate,"MAIN_INSTALLATION_HANDOFF_UNCONFIRMED");
  nm_installed_fate f{};if(!table->fate(table,&f))return Throw(isolate,"MAIN_INSTALLATION_HANDOFF_UNCONFIRMED");
  ProjectInstallationFate(args,f);
}
// This is a fixed Native shape check, never a caller verifier. Proxy is
// rejected before property operations. A fresh intrinsic realm supplies only
// Object.isFrozen; it neither runs source nor imports a JS callback.
void ModelSdkPortShape(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  const auto context = isolate->GetCurrentContext();
  const auto reject = [&]() { args.GetReturnValue().Set(false); };
  if ((args.Length() != 1 && args.Length() != 2) || !args[0]->IsObject() ||
      args[0]->IsFunction() || args[0]->IsProxy()) return reject();
  // NAPI type tags must never inspect Proxy inputs (V8 may abort). This
  // primitive-only branch is prior to, and cannot replace, private membership.
  if (args.Length() == 2) {
    args.GetReturnValue().Set(args[1]->IsTrue());return;
  }
  const auto port = args[0].As<v8::Object>();
  if (port->InternalFieldCount() != 0 || !port->GetPrototypeV2()->IsNull()) return reject();
  static const char* names[] = {"acquireModel", "consumeModel", "settleModel",
      "cancelModel", "assertModelCurrent", "assertModelLocal", "acquireProcess",
      "consumeProcess", "settleProcess", "cancelProcess", "assertProcessCurrent", "assertProcessLocal", "readProcessSourceRequest", "prepareReadonlyLeaf", "waitReadonlyLeafReady", "bindReadonlyLeaf", "goReadonlyLeaf", "cancelReadonlyLeaf", "waitReadonlyLeafClosed"};
  v8::Local<v8::Array> keys;
  if (!port->GetOwnPropertyNames(context, v8::ALL_PROPERTIES,
      v8::KeyConversionMode::kConvertToString).ToLocal(&keys) || keys->Length() != 19)
    return reject();
  for (const char* name : names) {
    v8::Local<v8::Value> descriptor;
    if (!port->GetOwnPropertyDescriptor(context, Text(isolate, name)).ToLocal(&descriptor) ||
        !descriptor->IsObject() || descriptor->IsProxy()) return reject();
    const auto data = descriptor.As<v8::Object>();
    v8::Local<v8::Value> value, writable, configurable;
    if (!data->HasOwnProperty(context, Text(isolate, "value")).FromMaybe(false) ||
        !data->Get(context, Text(isolate, "value")).ToLocal(&value) ||
        !value->IsFunction() || value->IsProxy() ||
        !data->Get(context, Text(isolate, "writable")).ToLocal(&writable) ||
        !writable->IsFalse() ||
        !data->Get(context, Text(isolate, "configurable")).ToLocal(&configurable) ||
        !configurable->IsFalse()) return reject();
  }
  bool frozen = false;
  {
    const auto pristine = v8::Context::New(isolate);
    v8::Context::Scope scope(pristine);
    v8::Local<v8::Value> object, method, result;
    if (!pristine->Global()->Get(pristine, Text(isolate, "Object")).ToLocal(&object) ||
        !object.As<v8::Object>()->Get(pristine, Text(isolate, "isFrozen")).ToLocal(&method) ||
        !method->IsFunction()) return reject();
    v8::Local<v8::Value> input[] = {port};
    if (!method.As<v8::Function>()->Call(pristine, object, 1, input).ToLocal(&result)) return;
    frozen = result->IsTrue();
  }
  args.GetReturnValue().Set(frozen);
}
NODE_MODULE_INIT() {
#ifdef NR_MAIN_INSTALLATION_COMPONENT
  v8::Local<v8::Function> audit;
  if(!v8::Function::New(context,ComponentInstallationCapsule).ToLocal(&audit)||!exports->CreateDataProperty(context,Text(v8::Isolate::GetCurrent(),"componentReadOriginalCapsule"),audit).FromMaybe(false))return;
#endif
  v8::Local<v8::Function> shape;
  if (!v8::Function::New(context, ModelSdkPortShape).ToLocal(&shape) ||
      !exports->DefineOwnProperty(context, Text(v8::Isolate::GetCurrent(), "__originalModelSdkPortShape"),
          shape, static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete | v8::DontEnum))
          .FromMaybe(false)) return;
  v8::Local<v8::Function> adopt;
  if(!v8::Function::New(context,AdoptInstallation).ToLocal(&adopt)||!exports->DefineOwnProperty(context,Text(v8::Isolate::GetCurrent(),"__originalMainInstallationAdopt"),adopt,static_cast<v8::PropertyAttribute>(v8::ReadOnly|v8::DontDelete|v8::DontEnum)).FromMaybe(false))return;
  // The only Electron entrypoint is ABI checked before any V8 code runs.
  // The original Node SDK constructs napi_env; no env/layout cast is used.
  napi_module_register_by_symbol(exports,module,context,nr_init_resource_authority,NAPI_VERSION);
}
#else
NODE_MODULE_INIT() {
  auto* isolate = v8::Isolate::GetCurrent();
  auto* state = NewState(context);
  if(!state)return Throw(isolate,"MAIN_BOOTSTRAP_ALLOCATION_FAILED");
  node::AddEnvironmentCleanupHook(isolate, Cleanup, state);
  auto data = v8::External::New(isolate, state);
  for (const auto& entry : {
#ifdef NR_MAIN_INSTALLATION_COMPONENT
           std::pair{"componentCreateOriginalCapsule",&ComponentInstallationBirth},
           std::pair{"componentReadOriginalCapsule",&ComponentInstallationCapsule},
           #ifdef NR_ROOT_IO_COMPONENT
           std::pair{"componentCreateOriginalCoreForBudget",&ComponentCoreForBudget},std::pair{"componentCloseOriginalCoreForBudget",&ComponentCloseCoreBudget},
#endif
#endif
#ifdef NR_MAIN_DSH_SERVICE_COMPONENT
           std::pair{"assertOriginalMainDshServiceComponent", &AssertServiceComponent},
#endif
           std::pair{"createOriginalMainIssuer", &Create},
           std::pair{"connectOriginalMainInstallation", &ConnectInstallation},
           std::pair{"assertOriginalMainInstallationCurrent", &AssertInstallation},
           std::pair{"closeOriginalMainInstallation", &CloseInstallation},
           std::pair{"readOriginalMainInstallationFate", &ReadInstallationFate},
           std::pair{"pingOriginalMainInstallation", &PingInstallation},
           std::pair{"prepareOriginalKSwarmChild", &CreateOriginalKSwarmPort},
           std::pair{"assertOriginalKSwarmChildPort", &AssertOriginalKSwarmPort},
           std::pair{"assertOriginalKSwarmChildTerminal", &AssertOriginalKSwarmPortTerminal},
           std::pair{"assertOriginalMainIssuerCurrent", &Assert},
           std::pair{"readOriginalMainClockCut", &ReadClockCut},
           std::pair{"revokeOriginalMainIssuer", &Revoke}}) {
    v8::Local<v8::Function> fn;
    if (!v8::Function::New(context, entry.second, data).ToLocal(&fn) ||
        !exports->CreateDataProperty(context, Text(isolate, entry.first), fn).FromMaybe(false))
      return;
  }
}
#endif
