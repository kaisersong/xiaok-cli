// Electron 39 ABI component. This birth is not a business/resource grant.
#include <node.h>
#include <uv.h>
#include <utility>
#include <new>
#include <cstdio>
#include <ctime>
#include <mach/mach_time.h>
#include <cstddef>
#include <climits>
#include "installed-main-handoff.h"
#include "../main-installation/protocol.h"
#if defined(NR_MAIN_INSTALLATION_COMPONENT) && NODE_MODULE_VERSION == 127
/* Node22.14 finite component ABI has the original V8 prototype API names.
 * This build always refuses Main role; production Electron keeps V2 APIs. */
#define SetPrototypeV2 SetPrototype
#define GetPrototypeV2 GetPrototype
#endif
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
#include "main-session-bridge.h"
void napi_module_register_by_symbol(v8::Local<v8::Object>,v8::Local<v8::Value>,
    v8::Local<v8::Context>,napi_addon_register_func,int32_t);
#endif

#if defined(NR_MAIN_INSTALLATION_COMPONENT) && !defined(MI_FIXTURE_BUILD)
#error "installation component cannot be built as production Main"
#endif
#if NODE_MODULE_VERSION != 140 && !defined(NR_MAIN_INSTALLATION_COMPONENT)
#error "main-bootstrap requires the reviewed Electron 39 ABI 140 headers"
#endif

namespace node {
namespace binding {
void GetLinkedBinding(const v8::FunctionCallbackInfo<v8::Value>&);
}
}

namespace {
constexpr int kElectronIsolateDataSlot = 5;
struct InstallationCapsule;
struct MainState {
  v8::Isolate* isolate;
  node::Environment* env;
  void* isolate_data;
  uv_loop_t* loop;
  uv_thread_t thread;
  v8::Global<v8::Context> context;
  v8::Global<v8::Object> app;
  v8::Global<v8::Object> issuer;
  v8::Global<v8::Value> failure;
  char clock_domain[65] = {};
  uint64_t clock_last_ns = 0;
  uint64_t clock_last_wall_ns = 0;
  InstallationCapsule* installation = nullptr;
  bool installation_attempted = false;
  v8::Global<v8::Object> installation_issuer;
  bool clock_invalid = false;
  bool attempted = false;
  bool revoked = false;
  bool closing = false;
  bool failed = false;
#ifdef NR_MAIN_INSTALLATION_COMPONENT
  bool component_core = false;
#endif
};

v8::Local<v8::String> Text(v8::Isolate* isolate, const char* value) {
  return v8::String::NewFromUtf8(isolate, value).ToLocalChecked();
}
void Throw(v8::Isolate* isolate, const char* code) {
  isolate->ThrowException(v8::Exception::Error(Text(isolate, code)));
}
[[maybe_unused]] void HandoffFailure(v8::Isolate* isolate,const char* code){
  auto error=v8::Exception::Error(Text(isolate,"MAIN_INSTALLATION_ORIGINAL_HANDOFF_REQUIRED"));
  if(error->IsObject())error.As<v8::Object>()->CreateDataProperty(isolate->GetCurrentContext(),Text(isolate,"code"),Text(isolate,code)).FromMaybe(false);
  isolate->ThrowException(error);
}
[[maybe_unused]] MainState* State(const v8::FunctionCallbackInfo<v8::Value>& args) {
  return static_cast<MainState*>(args.Data().As<v8::External>()->Value());
}
bool SameContext(MainState* state) {
  const auto thread = uv_thread_self();
  return !state->closing && state->isolate == v8::Isolate::GetCurrent() &&
      uv_thread_equal(&state->thread, &thread) &&
      state->context.Get(state->isolate) == state->isolate->GetCurrentContext() &&
      state->context.Get(state->isolate) == state->isolate->GetEnteredOrMicrotaskContext() &&
      node::GetCurrentEnvironment(state->isolate->GetCurrentContext()) == state->env;
}
bool MainPrecheck(MainState* state) {
#ifdef NR_MAIN_INSTALLATION_COMPONENT
  // Pure Node ABI transport probe. Never manufactures a Main role.
  (void)state;return false;
#else
  if (!SameContext(state) || !state->env || !state->isolate_data) return false;
  const auto context = state->isolate->GetCurrentContext();
  return context->GetNumberOfEmbedderDataFields() > kElectronIsolateDataSlot &&
      node::GetEnvironmentIsolateData(state->env) == state->isolate_data &&
      context->GetAlignedPointerFromEmbedderData(
          state->isolate, kElectronIsolateDataSlot,
          v8::kEmbedderDataTypeTagDefault) == state->isolate_data &&
      node::GetCurrentEventLoop(state->isolate) == state->loop &&
      state->loop == uv_default_loop();
#endif
}
[[maybe_unused]] bool Member(MainState* state, v8::Local<v8::Value> value) {
  // Identity membership precedes any supplied object's property/internal field.
  return !state->issuer.IsEmpty() && value->IsObject() &&
      state->issuer.Get(state->isolate) == value;
}
[[maybe_unused]] void Collected(const v8::WeakCallbackInfo<MainState>& info) {
  info.GetParameter()->issuer.Reset();
}
void DetachInstallation(MainState* state);
void CloseState(MainState* state) {
  DetachInstallation(state);
  state->closing = true;
  state->revoked = true;
  state->issuer.Reset();
  state->app.Reset();
  state->failure.Reset();
  state->context.Reset();
  state->installation_issuer.Reset();
}
void Cleanup(void* value) {
  auto* state = static_cast<MainState*>(value);
  CloseState(state);delete state;
}
MainState* NewState(v8::Local<v8::Context> context) {
  auto* state = new (std::nothrow) MainState;
  if (!state) return nullptr;
  auto* isolate = v8::Isolate::GetCurrent();
  state->isolate = isolate;state->env = node::GetCurrentEnvironment(context);
  state->isolate_data = state->env ? node::GetEnvironmentIsolateData(state->env) : nullptr;
  state->loop = node::GetCurrentEventLoop(isolate);state->thread = uv_thread_self();
  state->context.Reset(isolate, context);return state;
}
v8::MaybeLocal<v8::Object> BuildIssuer(MainState* state) {
  auto* isolate = state->isolate;
  const auto context = isolate->GetCurrentContext();
  v8::TryCatch caught(isolate);
  const auto failed = [&](const char* code) -> v8::MaybeLocal<v8::Object> {
    state->failed = true;
    state->failure.Reset(isolate, caught.HasCaught()
        ? caught.Exception() : v8::Exception::Error(Text(isolate, code)));
    return {};
  };
  v8::Local<v8::Function> lookup;
  v8::Local<v8::Value> binding, app;
  const v8::Local<v8::Value> name[] = {Text(isolate, "electron_browser_app")};
  const bool loaded = v8::Function::New(context, node::binding::GetLinkedBinding)
      .ToLocal(&lookup) &&
      lookup->Call(context, v8::Undefined(isolate), 1,
                   const_cast<v8::Local<v8::Value>*>(name)).ToLocal(&binding);
  if (loaded && binding->IsObject()) {
    // Obtain only an own data export. A modified JS export is not accepted as
    // a callback/getter; pre-bootstrap arbitrary Main VM tampering is outside
    // this component's stated threat boundary.
    v8::Local<v8::Value> description;
    if (binding.As<v8::Object>()->GetOwnPropertyDescriptor(context, Text(isolate, "app"))
            .ToLocal(&description) && description->IsObject()) {
      auto row = description.As<v8::Object>();
      if (row->HasOwnProperty(context, Text(isolate, "value")).FromMaybe(false) &&
          !row->Get(context, Text(isolate, "value")).ToLocal(&app)) app.Clear();
    }
  }
  if (caught.HasCaught() || app.IsEmpty() || !app->IsObject() || app->IsProxy() ||
      !MainPrecheck(state) || state->revoked || state->failed) {
    return failed("MAIN_BOOTSTRAP_NATIVE_BIRTH_UNCONFIRMED");
  }
  state->app.Reset(isolate, app.As<v8::Object>());
  auto issuer = v8::Object::New(isolate);
  if (!issuer->SetPrototypeV2(context, v8::Null(isolate)).FromMaybe(false) ||
      !issuer->SetIntegrityLevel(context, v8::IntegrityLevel::kFrozen).FromMaybe(false)) {
    return failed("MAIN_BOOTSTRAP_PROJECTION_UNCONFIRMED");
  }
  if (!MainPrecheck(state) || state->revoked || state->failed) {
    return failed("MAIN_BOOTSTRAP_NATIVE_BIRTH_UNCONFIRMED");
  }
  return issuer;
}
// The table/capsule stays registered until process teardown, even after its
// original Environment ends. A V8 Private external can therefore never dangle.
// Borrow callbacks independently check producer membership before dereference.
struct InstallationBorrow { InstallationBorrow* next;const void* bridge;const void* cookie;const void* environment; };
struct InstallationCapsule {
  nm_installation_handoff table;
  InstallationCapsule* next;
  MainState* owner;
  nm_installed_client* client;
  InstallationBorrow* borrowers;
};
static thread_local InstallationCapsule* installations;
InstallationCapsule* Capsule(const nm_installation_handoff* table) {
  for(auto* c=installations;c;c=c->next)if(&c->table==table)return c;
  return nullptr;
}
bool Infrastructure(InstallationCapsule* c) {
  return c&&c->owner&&!c->owner->closing&&MainPrecheck(c->owner)&&nm_installed_current(c->client);
}
int BorrowInstallation(const nm_installation_handoff* table,const void* issuer_slot,const void* environment,const void* bridge,const void* cookie) {
  auto* c=Capsule(table);
  if(!c||!issuer_slot||!environment||!bridge||!cookie||!Infrastructure(c)||c->owner->env!=environment)return 0;
  const auto value=*static_cast<const v8::Local<v8::Value>*>(issuer_slot);
  if(!Member(c->owner,value)||c->owner->installation_issuer.IsEmpty()||c->owner->installation_issuer.Get(c->owner->isolate)!=value)return 0;
  for(auto* b=c->borrowers;b;b=b->next)if(b->bridge==bridge)return b->cookie==cookie&&b->environment==environment;
  auto* b=new(std::nothrow) InstallationBorrow{c->borrowers,bridge,cookie,environment};if(!b)return 0;
  c->borrowers=b;return 1;
}
int BorrowRootStore(const nm_installation_handoff* table,const void* environment,const void* bridge,const void* cookie,nr_root_store_io** out){
  auto* c=Capsule(table);if(!out||!Infrastructure(c)||c->owner->env!=environment)return 0;
  bool original=false;
  for(auto* b=c->borrowers;b;b=b->next)if(b->bridge==bridge&&b->cookie==cookie&&b->environment==environment){original=true;break;}
  if(!original)return 0;
  return nm_installed_borrow_root_store(c->client,out);
}
int RootStoreCloseReady(const nm_installation_handoff* table,nr_root_store_io* io){auto* c=Capsule(table);return c?nm_installed_root_store_close_ready(c->client,io):-1;}
int PrepareBudgetWorker(const nm_installation_handoff* table,const void* issuer_slot,const void* environment,nm_budget_worker_lease** out){
 auto* c=Capsule(table);
 if(!c||!issuer_slot||!out||!c->owner||c->owner->env!=environment||!SameContext(c->owner)||c->owner->closing||c->owner->revoked||c->owner->failed)return 0;
 const auto value=*static_cast<const v8::Local<v8::Value>*>(issuer_slot);
 if(!Member(c->owner,value)||c->owner->installation_issuer.IsEmpty()||c->owner->installation_issuer.Get(c->owner->isolate)!=value)return 0;
 bool role=MainPrecheck(c->owner);
#ifdef NR_MAIN_INSTALLATION_COMPONENT
 role=role||c->owner->component_core;
#endif
 return role&&nm_installed_prepare_core_budget_worker(c->client,out);
}
int PrepareAdmissionStore(const nm_installation_handoff* table,const void* issuer_slot,const void* environment,nr_root_store_io** out){
 auto* c=Capsule(table);if(!c||!issuer_slot||!out||!c->owner||c->owner->env!=environment||!SameContext(c->owner)||c->owner->closing||c->owner->revoked||c->owner->failed)return 0;
 const auto value=*static_cast<const v8::Local<v8::Value>*>(issuer_slot);if(!Member(c->owner,value)||c->owner->installation_issuer.IsEmpty()||c->owner->installation_issuer.Get(c->owner->isolate)!=value)return 0;
 bool role=MainPrecheck(c->owner);
#ifdef NR_MAIN_INSTALLATION_COMPONENT
 role=role||c->owner->component_core;
#endif
 return role&&nm_installed_prepare_core_admission_store(c->client,out);
}
int InstallationCurrent(const nm_installation_handoff* table){return Infrastructure(Capsule(table));}
int InstallationPing(const nm_installation_handoff* table){auto* c=Capsule(table);return Infrastructure(c)&&nm_installed_ping(c->client);}
int InstallationClose(const nm_installation_handoff* table){auto* c=Capsule(table);return c&&nm_installed_close_owned(c->client);}
int InstallationFate(const nm_installation_handoff* table,nm_installed_fate* out){auto* c=Capsule(table);return c&&nm_installed_fate_read(c->client,out);}
void ReleaseInstallation(const nm_installation_handoff* table,const void* bridge,const void* cookie){
  auto* c=Capsule(table);if(!c)return;
  auto** at=&c->borrowers;while(*at){auto* b=*at;if(b->bridge==bridge&&b->cookie==cookie){*at=b->next;delete b;break;}at=&b->next;}
  // The Main infrastructure owns the client. Dropping one borrower never
  // closes it or depends on another Source's role/clock revocation.
}
void DetachInstallation(MainState* state){
  auto* c=state->installation;if(!c)return;
  c->owner=nullptr;state->installation=nullptr;
  nm_installed_close_owned(c->client);
  // Unknown and all borrowed references retain their original allocation.
  // No client/state is freed while a destination may invoke a negative read.
}
v8::Local<v8::Private> InstallationPrivate(v8::Isolate* isolate){return v8::Private::ForApi(isolate,Text(isolate,NM_HANDOFF_PRIVATE));}
InstallationCapsule* ReserveInstallation(MainState* state,v8::Local<v8::Object> issuer){
  auto* c=new(std::nothrow) InstallationCapsule{};if(!c)return nullptr;
  c->next=installations;c->owner=state;c->table={NM_HANDOFF_MAGIC,NM_HANDOFF_VERSION,sizeof(nm_installation_handoff),MI_BUILD_KIND,BorrowInstallation,InstallationCurrent,InstallationPing,InstallationClose,InstallationFate,BorrowRootStore,nm_installed_root_store_dispatch(),RootStoreCloseReady,PrepareBudgetWorker,nm_original_budget_worker_dispatch(),PrepareAdmissionStore,ReleaseInstallation};
  installations=c;state->installation=c;
  state->installation_issuer.Reset(state->isolate,issuer);
  c->client=nm_installed_create();return c;
}
[[maybe_unused]] void ConnectInstallation(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* state=State(args);auto* isolate=args.GetIsolate();
  if(args.Length()!=1)return Throw(isolate,"MAIN_INSTALLATION_ARGUMENT_INVALID");
  if(!Member(state,args[0]))return Throw(isolate,"MAIN_BOOTSTRAP_ISSUER_REQUIRED");
  if(!SameContext(state)||!MainPrecheck(state))return Throw(isolate,"MAIN_BOOTSTRAP_CONTEXT_REQUIRED");
  if(state->installation_attempted)return Throw(isolate,"MAIN_INSTALLATION_ALREADY_ATTEMPTED");
  if(state->revoked||state->failed)return Throw(isolate,"MAIN_BOOTSTRAP_ISSUER_REVOKED");
  state->installation_attempted=true;
  auto* c=ReserveInstallation(state,args[0].As<v8::Object>());
  if(!c)return Throw(isolate,"MAIN_INSTALLATION_ALLOCATION_FAILED");
  // Strong state/issuer/client ownership precedes the first fstat/read/socket.
  if(!c->client||!nm_installed_connect(c->client))return Throw(isolate,"MAIN_INSTALLATION_BIRTH_UNCONFIRMED");
  auto context=isolate->GetCurrentContext();
  if(!args[0].As<v8::Object>()->SetPrivate(context,InstallationPrivate(isolate),v8::External::New(isolate,&c->table)).FromMaybe(false)){
    nm_installed_close_owned(c->client);return Throw(isolate,"MAIN_INSTALLATION_HANDOFF_UNCONFIRMED");
  }
  args.GetReturnValue().Set(args[0]);
}
InstallationCapsule* OriginalInstallation(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* state=State(args);
  if(args.Length()!=1){Throw(args.GetIsolate(),"MAIN_INSTALLATION_ARGUMENT_INVALID");return nullptr;}
  if(!Member(state,args[0])){Throw(args.GetIsolate(),"MAIN_BOOTSTRAP_ISSUER_REQUIRED");return nullptr;}
  if(!state->installation){Throw(args.GetIsolate(),"MAIN_INSTALLATION_REQUIRED");return nullptr;}
  return state->installation;
}
[[maybe_unused]] void AssertInstallation(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* c=OriginalInstallation(args);if(c&&!Infrastructure(c))Throw(args.GetIsolate(),"MAIN_INSTALLATION_UNCONFIRMED");
}
[[maybe_unused]] void CloseInstallation(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* c=OriginalInstallation(args);if(c&&!nm_installed_close_owned(c->client))Throw(args.GetIsolate(),"MAIN_INSTALLATION_CLOSE_UNCONFIRMED");
}
void ProjectInstallationFate(const v8::FunctionCallbackInfo<v8::Value>& args,const nm_installed_fate& f){
  auto* isolate=args.GetIsolate();auto context=isolate->GetCurrentContext();auto out=v8::Object::New(isolate);
  if(!out->SetPrototypeV2(context,v8::Null(isolate)).FromMaybe(false))return;
  const auto flag=[&](const char* name,bool value){return out->CreateDataProperty(context,Text(isolate,name),v8::Boolean::New(isolate,value)).FromMaybe(false);};
  const auto number=[&](const char* name,uint64_t value){char text[32];std::snprintf(text,sizeof(text),"%llu",static_cast<unsigned long long>(value));return out->CreateDataProperty(context,Text(isolate,name),Text(isolate,text)).FromMaybe(false);};
  if(!flag("attempted",f.attempted)||!flag("entered",f.entered)||!flag("connected",f.connected)||!flag("closed",f.closed)||!flag("unknown",f.unknown)||!flag("seedClosed",f.seed_closed)||!flag("rootFilesClosed",f.root_files_closed)||!number("rootSequence",f.root_sequence)||!number("dispatchSequence",f.dispatch_sequence)||!flag("productionQualified",false))return;
  args.GetReturnValue().Set(out);
}
[[maybe_unused]] void ReadInstallationFate(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* c=OriginalInstallation(args);nm_installed_fate f{};if(!c)return;
  if(!nm_installed_fate_read(c->client,&f))return Throw(args.GetIsolate(),"MAIN_INSTALLATION_UNCONFIRMED");
  ProjectInstallationFate(args,f);
}
[[maybe_unused]] void PingInstallation(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* c=OriginalInstallation(args);if(c&&(!Infrastructure(c)||!nm_installed_ping(c->client)))Throw(args.GetIsolate(),"MAIN_INSTALLATION_UNCONFIRMED");
}
#ifdef NR_MAIN_INSTALLATION_COMPONENT
// Compiled only in a separate pure Node test DSO, whose MainPrecheck is false.
// Uses the original capsule/private/table rather than a test mirror.
[[maybe_unused]] void ComponentInstallationBirth(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* state=State(args);auto* isolate=args.GetIsolate();
  if(args.Length()!=0||!SameContext(state)||state->installation_attempted)return Throw(isolate,"COMPONENT_BIRTH_REJECTED");
  auto context=isolate->GetCurrentContext();auto issuer=v8::Object::New(isolate);
  if(!issuer->SetPrototypeV2(context,v8::Null(isolate)).FromMaybe(false)||!issuer->SetIntegrityLevel(context,v8::IntegrityLevel::kFrozen).FromMaybe(false))return Throw(isolate,"COMPONENT_BIRTH_REJECTED");
  state->issuer.Reset(isolate,issuer);state->installation_attempted=true;
  auto* c=ReserveInstallation(state,issuer);
  if(!c||!c->client||!issuer->SetPrivate(context,InstallationPrivate(isolate),v8::External::New(isolate,&c->table)).FromMaybe(false))return Throw(isolate,"COMPONENT_BIRTH_REJECTED");
  args.GetReturnValue().Set(issuer);
}
[[maybe_unused]] void ComponentInstallationCapsule(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* isolate=args.GetIsolate();v8::Local<v8::Value> hidden;
  if(args.Length()!=1||!args[0]->IsObject()||args[0]->IsProxy()||!args[0].As<v8::Object>()->GetPrivate(isolate->GetCurrentContext(),InstallationPrivate(isolate)).ToLocal(&hidden)||!hidden->IsExternal())return Throw(isolate,"COMPONENT_CAPSULE_REQUIRED");
  const auto* table=static_cast<const nm_installation_handoff*>(hidden.As<v8::External>()->Value());
  if(!table||table->magic!=NM_HANDOFF_MAGIC||table->version!=NM_HANDOFF_VERSION||table->size!=sizeof(*table)||table->build_kind!=MI_BUILD_KIND||!table->fate)return Throw(isolate,"COMPONENT_CAPSULE_REQUIRED");
  nm_installed_fate fate{};if(!table->fate(table,&fate))return Throw(isolate,"COMPONENT_CAPSULE_REQUIRED");
  ProjectInstallationFate(args,fate);
}
#ifdef NR_ROOT_IO_COMPONENT
[[maybe_unused]] void ComponentCloseCoreBudget(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* state=State(args);if(args.Length()!=1||!SameContext(state)||!Member(state,args[0])||!state->component_core||!state->installation||!nm_fixture_close_core_budget_owner(state->installation->client))return Throw(args.GetIsolate(),"COMPONENT_CORE_CLOSE_UNCONFIRMED");
 nm_installed_fate fate{};if(!nm_installed_fate_read(state->installation->client,&fate))return Throw(args.GetIsolate(),"COMPONENT_CORE_FATE_UNCONFIRMED");ProjectInstallationFate(args,fate);
}
[[maybe_unused]] void ComponentCoreForBudget(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* state=State(args);auto* isolate=args.GetIsolate();
 if(args.Length()!=0||!SameContext(state)||state->installation_attempted)return Throw(isolate,"COMPONENT_CORE_BIRTH_REJECTED");
 auto context=isolate->GetCurrentContext();auto issuer=v8::Object::New(isolate);
 state->issuer.Reset(isolate,issuer);state->installation_attempted=true;state->component_core=true;
 auto* c=ReserveInstallation(state,issuer);nr_root_store_io* io=nullptr;nr_root_store_identity identity{};const nr_root_bootstrap_claim* claim=nullptr;
 if(!c||!c->client||!issuer->SetPrivate(context,InstallationPrivate(isolate),v8::External::New(isolate,&c->table)).FromMaybe(false)||!nm_installed_connect(c->client)||!nm_installed_borrow_root_store(c->client,&io)||!nr_root_store_read_identity(io,&identity)||
    (identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity)))||
    !nr_root_store_bind_bootstrap(io,claim?NR_FRESH_COMMIT:NR_RECOVER_COMMITTED,claim,&identity))return Throw(isolate,"COMPONENT_CORE_BIND_UNCONFIRMED");
 args.GetReturnValue().Set(issuer);
}
#endif
#endif

[[maybe_unused]] void Create(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* state = State(args);
  auto* isolate = args.GetIsolate();
  if (args.Length() != 0) return Throw(isolate, "MAIN_BOOTSTRAP_ARGUMENT_INVALID");
  if (!SameContext(state)) return Throw(isolate, "MAIN_BOOTSTRAP_CONTEXT_REQUIRED");
  if (state->attempted) return Throw(isolate, "MAIN_BOOTSTRAP_ALREADY_ATTEMPTED");
  state->attempted = true;
  if (!MainPrecheck(state)) {
    state->failed = true;
    return Throw(isolate, "MAIN_BOOTSTRAP_ROLE_UNAVAILABLE");
  }
  v8::Local<v8::Object> issuer;
  if (!BuildIssuer(state).ToLocal(&issuer)) {
    // The SDK TryCatch has left scope before delivering its original failure.
    isolate->ThrowException(state->failure.Get(isolate));
    return;
  }
  state->issuer.Reset(isolate, issuer);
  state->issuer.SetWeak(state, Collected, v8::WeakCallbackType::kParameter);
  args.GetReturnValue().Set(issuer);
}
[[maybe_unused]] void Assert(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* state = State(args);
  if (args.Length() != 1) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_ARGUMENT_INVALID");
  if (!Member(state, args[0])) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_ISSUER_REQUIRED");
  if (!SameContext(state)) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_CONTEXT_REQUIRED");
  if (state->revoked) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_ISSUER_REVOKED");
  if (state->failed || !MainPrecheck(state)) {
    state->failed = true;
    return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_ISSUER_UNCONFIRMED");
  }
}
// A kernel cut is measurement provenance, not a UTC qualification or a
// deadline grant. UTC anchoring and persisted restart fences remain consumers.
[[maybe_unused]] void ReadClockCut(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* state = State(args);
  auto* isolate = args.GetIsolate();
  if (args.Length() != 1) return Throw(isolate, "MAIN_BOOTSTRAP_ARGUMENT_INVALID");
  if (!Member(state,args[0])) return Throw(isolate,"MAIN_BOOTSTRAP_ISSUER_REQUIRED");
  if (!SameContext(state)) return Throw(isolate,"MAIN_BOOTSTRAP_CONTEXT_REQUIRED");
  if (state->revoked) return Throw(isolate,"MAIN_BOOTSTRAP_ISSUER_REVOKED");
  if (state->failed || !MainPrecheck(state)) {
    state->failed=true;return Throw(isolate,"MAIN_BOOTSTRAP_ISSUER_UNCONFIRMED");
  }
  if(state->clock_invalid)return Throw(isolate,"MAIN_BOOTSTRAP_CLOCK_ROLLBACK");
  mach_timebase_info_data_t scale{};
  timespec wall{};
  if(mach_timebase_info(&scale)!=KERN_SUCCESS||!scale.denom){state->clock_invalid=true;return Throw(isolate,"MAIN_BOOTSTRAP_CLOCK_UNKNOWN");}
  const uint64_t start=mach_continuous_time();
  const int wall_result=clock_gettime(CLOCK_REALTIME,&wall);
  const uint64_t end=mach_continuous_time();
  const unsigned __int128 first_wide=(static_cast<unsigned __int128>(start)*scale.numer)/scale.denom;
  const unsigned __int128 last_wide=(static_cast<unsigned __int128>(end)*scale.numer)/scale.denom;
  if(wall_result||wall.tv_sec<0||wall.tv_nsec<0||wall.tv_nsec>=1000000000||last_wide<first_wide||last_wide-first_wide>1000000000ULL||last_wide>UINT64_MAX){state->clock_invalid=true;return Throw(isolate,"MAIN_BOOTSTRAP_CLOCK_UNKNOWN");}
  const uint64_t first=static_cast<uint64_t>(first_wide),last=static_cast<uint64_t>(last_wide);
  const unsigned __int128 wall_wide=static_cast<unsigned __int128>(wall.tv_sec)*1000000000ULL+wall.tv_nsec;
  if(wall_wide>UINT64_MAX||wall_wide/1000000ULL>253402300799999ULL){state->clock_invalid=true;return Throw(isolate,"MAIN_BOOTSTRAP_CLOCK_UNKNOWN");}
  const uint64_t wall_ns=static_cast<uint64_t>(wall_wide);
  // A backward wall adjustment exceeding one second is sticky for this boot
  // issuer. Continuous elapsed includes sleep; no JS Date is consulted.
  if(first<state->clock_last_ns||(state->clock_last_ns&&static_cast<unsigned __int128>(wall_ns)+1000000000ULL<static_cast<unsigned __int128>(state->clock_last_wall_ns)+(first-state->clock_last_ns))){state->clock_invalid=true;return Throw(isolate,"MAIN_BOOTSTRAP_CLOCK_ROLLBACK");}
  if(!state->clock_domain[0]){
    unsigned char nonce[32];if(uv_random(nullptr,nullptr,nonce,sizeof(nonce),0,nullptr)){state->clock_invalid=true;return Throw(isolate,"MAIN_BOOTSTRAP_CLOCK_UNKNOWN");}
    for(size_t i=0;i<sizeof(nonce);i++)std::snprintf(state->clock_domain+i*2,3,"%02x",nonce[i]);
  }
  state->clock_last_ns=last;state->clock_last_wall_ns=wall_ns;
  auto context=isolate->GetCurrentContext();auto out=v8::Object::New(isolate);
  out->SetPrototypeV2(context,v8::Null(isolate)).Check();
  char lower[32],upper[32];std::snprintf(lower,sizeof(lower),"%llu",static_cast<unsigned long long>(first));std::snprintf(upper,sizeof(upper),"%llu",static_cast<unsigned long long>(last));
  if(!out->CreateDataProperty(context,Text(isolate,"kind"),Text(isolate,"main_kernel_clock_cut_v1")).FromMaybe(false)||!out->CreateDataProperty(context,Text(isolate,"domainId"),Text(isolate,state->clock_domain)).FromMaybe(false)||!out->CreateDataProperty(context,Text(isolate,"continuousLowerNs"),Text(isolate,lower)).FromMaybe(false)||!out->CreateDataProperty(context,Text(isolate,"continuousUpperNs"),Text(isolate,upper)).FromMaybe(false)||!out->CreateDataProperty(context,Text(isolate,"wallMs"),v8::Number::New(isolate,static_cast<double>(wall_ns/1000000ULL))).FromMaybe(false))return;
  args.GetReturnValue().Set(out);
}
[[maybe_unused]] void Revoke(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* state = State(args);
  if (args.Length() != 1) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_ARGUMENT_INVALID");
  if (!Member(state, args[0])) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_ISSUER_REQUIRED");
  if (!SameContext(state)) return Throw(args.GetIsolate(), "MAIN_BOOTSTRAP_CONTEXT_REQUIRED");
  state->revoked = true;
}
}  // namespace

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
           std::pair{"componentCreateOriginalCapsule",ComponentInstallationBirth},
           std::pair{"componentReadOriginalCapsule",ComponentInstallationCapsule},
           #ifdef NR_ROOT_IO_COMPONENT
           std::pair{"componentCreateOriginalCoreForBudget",ComponentCoreForBudget},std::pair{"componentCloseOriginalCoreForBudget",ComponentCloseCoreBudget},
#endif
#endif
           std::pair{"createOriginalMainIssuer", Create},
           std::pair{"connectOriginalMainInstallation", ConnectInstallation},
           std::pair{"assertOriginalMainInstallationCurrent", AssertInstallation},
           std::pair{"closeOriginalMainInstallation", CloseInstallation},
           std::pair{"readOriginalMainInstallationFate", ReadInstallationFate},
           std::pair{"pingOriginalMainInstallation", PingInstallation},
           std::pair{"assertOriginalMainIssuerCurrent", Assert},
           std::pair{"readOriginalMainClockCut", ReadClockCut},
           std::pair{"revokeOriginalMainIssuer", Revoke}}) {
    v8::Local<v8::Function> fn;
    if (!v8::Function::New(context, entry.second, data).ToLocal(&fn) ||
        !exports->CreateDataProperty(context, Text(isolate, entry.first), fn).FromMaybe(false))
      return;
  }
}
#endif
