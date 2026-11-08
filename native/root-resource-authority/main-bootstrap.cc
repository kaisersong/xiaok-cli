// Electron 39 ABI component. This birth is not a business/resource grant.
#include <node.h>
#include <uv.h>
#include <node_buffer.h>
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
#if defined(NR_MAIN_DSH_SERVICE_COMPONENT) && (!defined(MI_FIXTURE_BUILD) || defined(NR_MAIN_INSTALLATION_COMPONENT) || NODE_MODULE_VERSION != 140)
#error "service component requires genuine Electron 39 fixture Main only"
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
#include "main-bootstrap-installation-private.h"
#include "../kswarm-authority-source/kswarm-parent-port-private.h"
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
#ifdef NR_MAIN_DSH_SERVICE_COMPONENT
// Component identity only. No handshake, seed, IO, resource or known fact.
void AssertServiceComponent(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Assert(args);
}
#endif
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

#include "main-bootstrap-embedded-private.h"
