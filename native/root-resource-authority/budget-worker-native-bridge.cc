// Fixed native Worker carrier and same-module protected SQLite consumer.
// A carrier contains no key, descriptor, path or caller-verifiable authority.
#include <node.h>
#include <node_api.h>
#if NODE_MODULE_VERSION != 140 && !(defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT))
#error "Protected budget Worker requires the fixed Electron ABI 140 or an explicit fixture component"
#endif
#include <uv.h>
#include <pthread.h>
#include <unistd.h>
#include <memory>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <atomic>
#include <cstdio>
#include "installed-budget-worker-io.h"
#include "installed-main-handoff.h"
#include "../main-installation/protocol.h"
#include "root-store-io-dispatch.h"
#include "../protected-sqlite-facade/protected-sqlite-facade.h"
#include "../protected-sqlite-facade/protected-namespace-bridge.h"
namespace node {namespace binding {void GetInternalBinding(const v8::FunctionCallbackInfo<v8::Value>&);}}
void napi_module_register_by_symbol(v8::Local<v8::Object>,v8::Local<v8::Value>,v8::Local<v8::Context>,napi_addon_register_func,int32_t);
#if defined(MI_FIXTURE_BUILD) && defined(NR_BUDGET_DIAGNOSTIC_BACKTRACE)
#define BUDGET_PHASE(label) ((void)::write(STDERR_FILENO,label "\n",sizeof(label "\n")-1))
#else
#define BUDGET_PHASE(label) ((void)0)
#endif
namespace {
using namespace v8;
Local<String> text(Isolate* i,const char* s){return String::NewFromUtf8(i,s).ToLocalChecked();}
void deny(Isolate* i,const char* s){i->ThrowException(Exception::Error(text(i,s)));}
struct Environment;
struct Birth {
 Birth* next;pid_t pid;Environment* owner;Environment* worker=nullptr;
 nm_installed_client* client=nullptr;nr_root_store_io* root=nullptr;
 nm_budget_worker_lease* lease=nullptr;Global<SharedArrayBuffer> carrier;
 void* carrier_data=nullptr;size_t carrier_length=0;
 const nm_budget_worker_dispatch* ops=nullptr;
 std::mutex mutex;std::condition_variable ready;bool published=false,failed=false,retired=false,env_retired=false;
 uint64_t thread_id=0;
};
struct Environment {
 Isolate* isolate;node::Environment* native;uv_loop_t* loop;pthread_t thread;
 Global<Context> context;Global<Function> namespace_function;Global<Value> raw_binding,raw_failure;
 Birth* birth=nullptr;std::atomic<bool> cleanup{false};
};
static thread_local Environment* local_environment;
static thread_local nr_root_store_io* namespace_slot;
static std::mutex births_mutex;
static Birth* births;
static std::atomic<pid_t> births_pid{};
bool current(Environment* e){return e&&!e->cleanup&&e==local_environment&&e->isolate==Isolate::GetCurrent()&&pthread_equal(e->thread,pthread_self())&&node::GetCurrentEnvironment(e->isolate->GetCurrentContext())==e->native&&node::GetCurrentEventLoop(e->isolate)==e->loop&&e->context.Get(e->isolate)==e->isolate->GetCurrentContext();}
Birth* member(Local<Value> value){
 if(!value->IsSharedArrayBuffer()||value->IsProxy()||births_pid!=getpid())return nullptr;
 auto buffer=value.As<SharedArrayBuffer>();
 void* data=buffer->Data();size_t length=buffer->ByteLength();
 std::lock_guard<std::mutex> lock(births_mutex);
 for(auto* r=births;r;r=r->next)if(r->carrier_data&&r->carrier_data==data&&r->carrier_length==length)return r;
 return nullptr;
}
bool worker_identity(Environment* e,uint64_t* id,bool* main){
 BUDGET_PHASE("BUDGET_NATIVE_IDENTITY_ENTER");
 if(!current(e))return false;auto* i=e->isolate;
 // Electron may call an addon from a context associated with the same Node
 // Environment without that context being the Environment's principal realm.
 // GetInternalBinding requires the SDK-owned principal realm, not a caller
 // context. The original addon context/thread/loop checks remain above.
 auto c=node::GetMainContext(e->native);
 if(c.IsEmpty()||node::GetCurrentEnvironment(c)!=e->native)return false;
#if defined(MI_FIXTURE_BUILD)
 std::fprintf(stderr,"ORIGINAL_BUDGET_BINDING_PRINCIPAL_CONTEXT:%d\n",c!=i->GetCurrentContext());
#endif
 Context::Scope principal_scope(c);
 Local<Function> fn;Local<Value> raw;Local<Value> input[]={text(i,"worker")};TryCatch caught(i);
 if(!Function::New(c,node::binding::GetInternalBinding).ToLocal(&fn)||!fn->Call(c,Undefined(i),1,input).ToLocal(&raw)){
  if(caught.HasCaught()){e->raw_failure.Reset(i,caught.Exception());caught.ReThrow();}return false;
 }
 e->raw_binding.Reset(i,raw);
 BUDGET_PHASE("BUDGET_NATIVE_IDENTITY_BINDING_RETURNED");
 if(!raw->IsObject()||raw->IsProxy())return false;
 Local<Value> a,b,x,y;
 if(!raw.As<Object>()->GetOwnPropertyDescriptor(c,text(i,"threadId")).ToLocal(&a)||!a->IsObject()||!a.As<Object>()->HasOwnProperty(c,text(i,"value")).FromMaybe(false)||!a.As<Object>()->Get(c,text(i,"value")).ToLocal(&x)||!x->IsUint32()||
    !raw.As<Object>()->GetOwnPropertyDescriptor(c,text(i,"isMainThread")).ToLocal(&b)||!b->IsObject()||!b.As<Object>()->HasOwnProperty(c,text(i,"value")).FromMaybe(false)||!b.As<Object>()->Get(c,text(i,"value")).ToLocal(&y)||!y->IsBoolean())return false;
 *id=x.As<Uint32>()->Value();*main=y->IsTrue();return true;
}
void cleanup(void* raw){
 auto* e=static_cast<Environment*>(raw);e->cleanup=true;
 if(e->birth){auto* b=e->birth;
  bool worker=false,owner=false;{std::lock_guard<std::mutex> lock(b->mutex);worker=b->worker==e;owner=b->owner==e;}
  if(worker){bool closed=b->ops&&b->ops->cleanup_environment_current(b->lease)!=0;std::lock_guard<std::mutex> lock(b->mutex);b->env_retired=closed;if(!closed)b->failed=true;}
  else if(owner&&b->client)nm_installed_close_owned(b->client);
  if(owner)b->carrier.Reset();
 }
 e->namespace_function.Reset();e->raw_binding.Reset();e->raw_failure.Reset();e->context.Reset();
 // Native birth/backing/client rows remain held. No cleanup order assumption.
}
napi_value make_namespace(napi_env env,napi_callback_info info){
 size_t argc=0;if(napi_get_cb_info(env,info,&argc,nullptr,nullptr,nullptr)!=napi_ok)return nullptr;
 auto* io=namespace_slot;namespace_slot=nullptr;
 if(!io||!current(local_environment)){napi_throw_error(env,nullptr,"ORIGINAL_WORKER_NAMESPACE_SLOT_REQUIRED");return nullptr;}
 return ps_create_original_namespace(env,io);
}
napi_value initialize_namespace(napi_env env,napi_value exports){
 if(!ps_addon_exports(env,exports))return nullptr;
 napi_value fn;if(napi_create_function(env,"originalWorkerNamespace",NAPI_AUTO_LENGTH,make_namespace,nullptr,&fn)!=napi_ok)return nullptr;
 napi_property_descriptor property={};property.utf8name="__namespaceBirth";property.value=fn;property.attributes=napi_default_jsproperty;
 if(napi_define_properties(env,exports,1,&property)!=napi_ok)return nullptr;
 return exports;
}
void adopt(const FunctionCallbackInfo<Value>& args){
 BUDGET_PHASE("BUDGET_NATIVE_ADOPT_ENTER");
 auto* i=args.GetIsolate();auto* e=local_environment;
 if(args.Length()!=1||!current(e))return deny(i,"ORIGINAL_WORKER_CARRIER_REQUIRED");
 auto* b=member(args[0]);if(!b||b->pid!=getpid()||b->owner==e)return deny(i,"ORIGINAL_WORKER_CARRIER_REQUIRED");
 uint64_t actual=0;bool main=true;if(!worker_identity(e,&actual,&main)){if(!e->raw_failure.IsEmpty())return;return deny(i,"ORIGINAL_WORKER_ENVIRONMENT_REQUIRED");}if(main||!actual)return deny(i,"ORIGINAL_WORKER_ENVIRONMENT_REQUIRED");
 {std::unique_lock<std::mutex> lock(b->mutex);
  if(!b->ready.wait_for(lock,std::chrono::milliseconds(500),[b]{return b->published||b->failed;})){b->failed=true;return deny(i,"ORIGINAL_WORKER_BIRTH_UNCONFIRMED");}
  if(b->failed||b->owner->cleanup||b->worker||b->thread_id!=actual)return deny(i,"ORIGINAL_WORKER_ENVIRONMENT_REQUIRED");
  b->worker=e;e->birth=b;
 }
 nr_root_store_io* io=nullptr;
 if(!b->ops||!b->ops->bind_current(b->lease,actual,&io)||!io||(b->ops->io!=nm_installed_root_store_dispatch()&&!nm_installed_import_root_store(b->ops->io,io)))return deny(i,"ORIGINAL_WORKER_IO_REQUIRED");
 nr_root_store_identity identity;const nr_root_bootstrap_claim* claim=nullptr;
 if(!nr_root_store_read_identity(io,&identity)||(identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(io,&claim)||!nr_root_store_read_claim(io,claim,&identity))))return deny(i,"ORIGINAL_WORKER_CLAIM_REQUIRED");
 if(namespace_slot||e->namespace_function.IsEmpty())return deny(i,"ORIGINAL_WORKER_NAMESPACE_SLOT_REQUIRED");
 namespace_slot=io;Local<Value> result;auto c=i->GetCurrentContext();TryCatch caught(i);
 bool ok=e->namespace_function.Get(i)->Call(c,Undefined(i),0,nullptr).ToLocal(&result);
 // Any throw leaves no call slot. The original pending exception is preserved.
 namespace_slot=nullptr;if(!ok){if(caught.HasCaught()){e->raw_failure.Reset(i,caught.Exception());caught.ReThrow();}std::lock_guard<std::mutex> lock(b->mutex);b->failed=true;return;}args.GetReturnValue().Set(result);
}
void retire(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;
 if(args.Length()!=1||!current(e))return deny(i,"ORIGINAL_WORKER_CARRIER_REQUIRED");
 auto* b=member(args[0]);if(!b||b->worker!=e||e->birth!=b||!b->ops||!b->ops->retire_current(b->lease))return deny(i,"ORIGINAL_WORKER_IO_STILL_HELD");
 {std::lock_guard<std::mutex> lock(b->mutex);b->retired=true;}
}

void commit_namespace(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;
 if(args.Length()!=1||!current(e))return deny(i,"ORIGINAL_WORKER_CARRIER_REQUIRED");
 auto* b=member(args[0]);if(!b||b->worker!=e||e->birth!=b||!b->ops||!b->ops->bind_namespace_current(b->lease))return deny(i,"ORIGINAL_WORKER_NAMESPACE_UNCONFIRMED");
}
void prepare_original(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;uint64_t id=1;bool main=false;
 if(args.Length()!=1||!current(e)||e->birth||!args[0]->IsObject()||args[0]->IsProxy())return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_REQUIRED");
 if(!worker_identity(e,&id,&main)){if(!e->raw_failure.IsEmpty())return;return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_REQUIRED");}if(!main||id)return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_REQUIRED");
 Local<Value> hidden;auto c=i->GetCurrentContext();
 if(!args[0].As<Object>()->GetPrivate(c,Private::ForApi(i,text(i,NM_HANDOFF_PRIVATE))).ToLocal(&hidden)||!hidden->IsExternal())return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_REQUIRED");
 auto* table=static_cast<const nm_installation_handoff*>(hidden.As<External>()->Value());
 if(!table||table->magic!=NM_HANDOFF_MAGIC||table->version!=NM_HANDOFF_VERSION||table->size!=sizeof(*table)||table->build_kind!=MI_BUILD_KIND||!table->prepare_budget_worker||!table->budget_worker_ops)return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_REQUIRED");
 auto* b=new(std::nothrow) Birth{};if(!b)return deny(i,"ORIGINAL_WORKER_ALLOCATION_FAILED");
 b->pid=getpid();b->owner=e;e->birth=b;const Local<Value> original=args[0];
 BUDGET_PHASE("BUDGET_NATIVE_CORE_PREPARE_ENTER");
 if(!table->prepare_budget_worker(table,&original,e->native,&b->lease)||!b->lease)return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_UNCONFIRMED");
 BUDGET_PHASE("BUDGET_NATIVE_CORE_PREPARE_RETURNED");
 b->ops=table->budget_worker_ops;
 if(!b->ops->publish||!b->ops->bind_current||!b->ops->bind_namespace_current||!b->ops->retire_current||!b->ops->cleanup_environment_current||!b->ops->io)return deny(i,"ORIGINAL_CORE_BUDGET_SOURCE_UNCONFIRMED");
 // Avoid std::shared_ptr in a V8 ABI boundary: Electron uses Chromium's
 // std::__Cr, whereas addons use the platform libc++ std::__1. V8 owns the
 // allocation; this original Global pins its actual data address against GC
 // and address reuse. Worker structured clones share that same backing data.
 BUDGET_PHASE("BUDGET_NATIVE_CARRIER_ENTER");
 auto carrier=SharedArrayBuffer::New(i,32);
 b->carrier.Reset(i,carrier);b->carrier_data=carrier->Data();b->carrier_length=carrier->ByteLength();
 if(!b->carrier_data||b->carrier_length!=32)return deny(i,"ORIGINAL_WORKER_CARRIER_UNCONFIRMED");
 {std::lock_guard<std::mutex> lock(births_mutex);births_pid=getpid();b->next=births;births=b;}
 args.GetReturnValue().Set(carrier);
 BUDGET_PHASE("BUDGET_NATIVE_CARRIER_RETURNED");
}
void publish_original(const FunctionCallbackInfo<Value>& args){
 BUDGET_PHASE("BUDGET_NATIVE_PUBLISH_ENTER");
 auto* i=args.GetIsolate();auto* e=local_environment;
 if(args.Length()!=2||!current(e)||!args[1]->IsUint32())return deny(i,"ORIGINAL_WORKER_BIRTH_REQUIRED");
 auto* b=member(args[0]);if(!b||b->owner!=e||e->birth!=b||!b->ops)return deny(i,"ORIGINAL_WORKER_BIRTH_REQUIRED");
 std::lock_guard<std::mutex> lock(b->mutex);
 if(b->failed||b->owner->cleanup||b->published||!b->ops->publish(b->lease,args[1].As<Uint32>()->Value()))return deny(i,"ORIGINAL_WORKER_BIRTH_UNCONFIRMED");
 b->thread_id=args[1].As<Uint32>()->Value();b->published=true;b->ready.notify_all();
}
void assert_closed(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;if(args.Length()!=1||!current(e))return deny(i,"ORIGINAL_WORKER_BIRTH_REQUIRED");
 auto* b=member(args[0]);if(!b||b->owner!=e)return deny(i,"ORIGINAL_WORKER_BIRTH_REQUIRED");
 std::lock_guard<std::mutex> lock(b->mutex);if(b->failed||!b->retired||!b->env_retired)return deny(i,"ORIGINAL_WORKER_IO_STILL_HELD");
}
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
// A bounded real client/helper producer for Node components, never Main role.
void component_prepare(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;uint64_t id=1;bool main=false;
 if(args.Length()!=0||!current(e)||e->birth)return deny(i,"COMPONENT_MAIN_ENVIRONMENT_REQUIRED");
 if(!worker_identity(e,&id,&main)){if(!e->raw_failure.IsEmpty())return;return deny(i,"COMPONENT_MAIN_ENVIRONMENT_REQUIRED");}if(!main||id)return deny(i,"COMPONENT_MAIN_ENVIRONMENT_REQUIRED");
 auto* b=new(std::nothrow) Birth{};if(!b)return deny(i,"COMPONENT_ALLOCATION_FAILED");
 b->pid=getpid();b->owner=e;e->birth=b;
 b->client=nm_installed_create();nr_root_store_identity identity;const nr_root_bootstrap_claim* claim=nullptr;
 if(!b->client||!nm_installed_connect(b->client)||!nm_installed_borrow_root_store(b->client,&b->root)||!nr_root_store_read_identity(b->root,&identity)||!nr_root_store_claim_fresh(b->root,&claim)||!nr_root_store_read_claim(b->root,claim,&identity)||!nr_root_store_bind_bootstrap(b->root,NR_FRESH_COMMIT,claim,&identity))return deny(i,"COMPONENT_ROOT_BIND_UNCONFIRMED");
 unsigned char scope[32];memset(scope,0x22,sizeof(scope));
 if(!nm_budget_worker_prepare(b->client,scope,&b->lease))return deny(i,"COMPONENT_BUDGET_BIRTH_UNCONFIRMED");
 b->ops=nm_original_budget_worker_dispatch();
 auto carrier=SharedArrayBuffer::New(i,32);b->carrier.Reset(i,carrier);b->carrier_data=carrier->Data();b->carrier_length=carrier->ByteLength();
 if(!b->carrier_data||b->carrier_length!=32)return deny(i,"COMPONENT_CARRIER_UNCONFIRMED");
 {std::lock_guard<std::mutex> lock(births_mutex);births_pid=getpid();b->next=births;births=b;}
 args.GetReturnValue().Set(carrier);
}
void component_publish(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;
 if(args.Length()!=2||!current(e)||!args[1]->IsUint32())return deny(i,"COMPONENT_ORIGINAL_BIRTH_REQUIRED");
 auto* b=member(args[0]);if(!b||b->owner!=e||e->birth!=b)return deny(i,"COMPONENT_ORIGINAL_BIRTH_REQUIRED");
 std::lock_guard<std::mutex> lock(b->mutex);
 if(b->failed||b->published||!nm_budget_worker_publish(b->lease,args[1].As<Uint32>()->Value()))return deny(i,"COMPONENT_ORIGINAL_WORKER_REQUIRED");
 b->thread_id=args[1].As<Uint32>()->Value();b->published=true;b->ready.notify_all();
}
void component_close(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto* e=local_environment;
 if(args.Length()!=1||!current(e))return deny(i,"COMPONENT_ORIGINAL_BIRTH_REQUIRED");
 auto* b=member(args[0]);if(!b||b->owner!=e)return deny(i,"COMPONENT_ORIGINAL_BIRTH_REQUIRED");
 {std::lock_guard<std::mutex> lock(b->mutex);if(b->failed||!b->retired||!b->env_retired)return deny(i,"COMPONENT_WORKER_STILL_HELD");}
 if(nm_installed_root_store_close_ready(b->client,b->root)!=1||nr_root_store_release_owned(b->root)!=NR_SQL_FILES_CLOSED||!nm_installed_close_owned(b->client))return deny(i,"COMPONENT_ROOT_STILL_HELD");
 nm_installed_fate f{};if(!nm_installed_fate_read(b->client,&f))return deny(i,"COMPONENT_FATE_UNCONFIRMED");
 auto out=Object::New(i);auto c=i->GetCurrentContext();out->CreateDataProperty(c,text(i,"rootFilesClosed"),Boolean::New(i,f.root_files_closed)).Check();out->CreateDataProperty(c,text(i,"unknown"),Boolean::New(i,f.unknown)).Check();out->CreateDataProperty(c,text(i,"productionQualified"),False(i)).Check();args.GetReturnValue().Set(out);
}
#endif
NODE_MODULE_INIT(){
 BUDGET_PHASE("BUDGET_NATIVE_MODULE_INIT_ENTER");
 auto* i=v8::Isolate::GetCurrent();auto* e=new(std::nothrow) Environment{i,node::GetCurrentEnvironment(context),node::GetCurrentEventLoop(i),pthread_self(),Global<Context>(i,context),{},{},{}};
 if(!e)return deny(i,"ORIGINAL_WORKER_ENVIRONMENT_REQUIRED");local_environment=e;node::AddEnvironmentCleanupHook(i,cleanup,e);
 napi_module_register_by_symbol(exports,module,context,initialize_namespace,NAPI_VERSION);
 Local<Value> descriptor,raw;if(!exports->GetOwnPropertyDescriptor(context,text(i,"__namespaceBirth")).ToLocal(&descriptor)||!descriptor->IsObject()||!descriptor.As<Object>()->HasOwnProperty(context,text(i,"value")).FromMaybe(false)||!descriptor.As<Object>()->Get(context,text(i,"value")).ToLocal(&raw)||!raw->IsFunction()||raw->IsProxy())return deny(i,"ORIGINAL_WORKER_NAMESPACE_REQUIRED");
 e->namespace_function.Reset(i,raw.As<Function>());if(!exports->Delete(context,text(i,"__namespaceBirth")).FromMaybe(false))return deny(i,"ORIGINAL_WORKER_NAMESPACE_REQUIRED");
#ifdef NR_ADMISSION_NAMESPACE_BRIDGE
 nr_install_admission_namespace_exports(context,exports);
#endif
 for(const auto& pair:{std::pair{"adoptOriginalBudgetWorker",adopt},std::pair{"retireOriginalBudgetWorker",retire},std::pair{"commitOriginalBudgetWorkerNamespace",commit_namespace},std::pair{"prepareOriginalBudgetWorker",prepare_original},std::pair{"publishOriginalBudgetWorker",publish_original},std::pair{"assertOriginalBudgetWorkerIoClosed",assert_closed},
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
 std::pair{"componentPrepareBudgetWorker",component_prepare},std::pair{"componentPublishBudgetWorker",component_publish},std::pair{"componentCloseBudgetWorker",component_close},
#endif
 }){Local<Function> fn;if(!Function::New(context,pair.second).ToLocal(&fn)||!exports->CreateDataProperty(context,text(i,pair.first),fn).FromMaybe(false))return;}
 BUDGET_PHASE("BUDGET_NATIVE_MODULE_INIT_RETURNED");
}
}

v8::MaybeLocal<v8::Value> nr_create_original_protected_namespace(v8::Local<v8::Context> context,nr_root_store_io* io){
 auto* e=local_environment;auto* i=v8::Isolate::GetCurrent();nr_root_store_identity identity;
 if(!i||context!=i->GetCurrentContext()||!current(e)||namespace_slot||!io||!nr_root_store_read_identity(io,&identity)||identity.birth_state<NR_CLAIMED||e->namespace_function.IsEmpty()){deny(i,"ORIGINAL_NAMESPACE_SOURCE_REQUIRED");return {};}
 namespace_slot=io;v8::Local<v8::Value> result;bool ok=e->namespace_function.Get(i)->Call(context,v8::Undefined(i),0,nullptr).ToLocal(&result);namespace_slot=nullptr;
 return ok?v8::MaybeLocal<v8::Value>(result):v8::MaybeLocal<v8::Value>();
}
