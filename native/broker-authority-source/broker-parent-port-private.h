#include "broker-child-launch.h"
#if defined(NR_BROKER_PORT_ALLOCATION_FAULT) && !defined(NR_MAIN_INSTALLATION_COMPONENT)
#error "Broker allocation fault is restricted to the existing pure Node fixture domain"
#endif
/* Same-Main TU only; no cross-DSO callback or caller table grants a birth. */
static int PrepareBrokerChild(InstallationCapsule* capsule,MainState* owner,v8::Local<v8::Value> issuer,nm_broker_child_birth** out){
 bool original=false;for(auto* candidate=installations;candidate;candidate=candidate->next)if(candidate==capsule){original=true;break;}
 if(!original||!owner||!out||capsule->owner!=owner||owner->installation!=capsule||!SameContext(owner)||owner->closing||owner->failed||owner->revoked)return 0;
 if(!Member(owner,issuer)||owner->installation_issuer.IsEmpty()||owner->installation_issuer.Get(owner->isolate)!=issuer)return 0;
 bool role=MainPrecheck(owner);
#ifdef NR_MAIN_INSTALLATION_COMPONENT
 role=role||owner->component_core;
#endif
 return role&&nm_installed_prepare_core_broker_child(capsule->client,out);
}
/* Same original Main TU. This fixed SDK exposes business bytes, never an IO
 * descriptor/key, caller-selected executable, PID, family or known callback. */
struct BrokerParentPort {
 BrokerParentPort* next;InstallationCapsule* installation;MainState* owner;
 nm_broker_child_birth* birth;node::Environment* environment;uv_thread_t thread;
 v8::Global<v8::Context> context;v8::Global<v8::Object> object;
 bool launch_entered=false,launched=false,exited=false,joined=false;
};
static BrokerParentPort* broker_parent_ports;
static bool BrokerPortContext(BrokerParentPort* row,v8::Isolate* isolate){
 if(!row||!row->owner||row->owner->isolate!=isolate)return false;
 const auto thread=uv_thread_self();return uv_thread_equal(&thread,&row->thread)&&row->context.Get(isolate)==isolate->GetCurrentContext()&&row->context.Get(isolate)==isolate->GetEnteredOrMicrotaskContext()&&node::GetCurrentEnvironment(isolate->GetCurrentContext())==row->environment;
}
static BrokerParentPort* BrokerPort(const v8::FunctionCallbackInfo<v8::Value>& args){
 if(!args.Data()->IsExternal())return nullptr;auto* candidate=static_cast<BrokerParentPort*>(args.Data().As<v8::External>()->Value());
 for(auto* row=broker_parent_ports;row;row=row->next)if(row==candidate)return BrokerPortContext(row,args.GetIsolate())&&!row->object.IsEmpty()&&row->object.Get(args.GetIsolate())==args.This()?row:nullptr;
 return nullptr;
}
static bool BrokerPortPositive(BrokerParentPort* row){
 if(!row||!row->owner||row->owner->closing||row->owner->failed||row->owner->revoked||!SameContext(row->owner))return false;
 bool role=MainPrecheck(row->owner);
#ifdef NR_MAIN_INSTALLATION_COMPONENT
 role=role||row->owner->component_core;
#endif
 return role&&row->installation&&nm_installed_current(row->installation->client);
}
static void BrokerPortLaunch(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()||!BrokerPortPositive(row)||row->launch_entered)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 row->launch_entered=true;
 if(!nm_broker_child_launch(row->birth))return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_LAUNCH_HELD");row->launched=true;
}
static void BrokerPortPoll(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()||!row||!row->launch_entered)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 int state=nm_broker_child_poll_owned(row->birth);if(state<0)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_WAIT_HELD");if(state==1)row->exited=true;
 int pid=0,status=0,known=0;if(!nm_broker_child_read_fate(row->birth,&pid,&status,&known))return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_WAIT_HELD");
 auto* isolate=args.GetIsolate();auto context=isolate->GetCurrentContext();auto out=v8::Object::New(isolate);if(!out->SetPrototypeV2(context,v8::Null(isolate)).FromMaybe(false))return;
 for(const auto& field:{std::pair{"pid",pid},std::pair{"waitStatus",status},std::pair{"state",state}})if(!out->CreateDataProperty(context,Text(isolate,field.first),v8::Integer::New(isolate,field.second)).FromMaybe(false))return;
 if(!out->SetIntegrityLevel(context,v8::IntegrityLevel::kFrozen).FromMaybe(false))return;args.GetReturnValue().Set(out);
}
static void BrokerPortRead(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()!=1||!row||!row->launch_entered||!args[0]->IsInt32())return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 unsigned char bytes[65536];uint32_t actual=0;int stream=args[0].As<v8::Int32>()->Value(),state=nm_broker_child_read_stream(row->birth,stream,bytes,sizeof(bytes),&actual);
 if(state<0)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_STREAM_HELD");auto* isolate=args.GetIsolate();auto context=isolate->GetCurrentContext();auto out=v8::Object::New(isolate);v8::Local<v8::String> data;
 if(!v8::String::NewFromOneByte(isolate,bytes,v8::NewStringType::kNormal,static_cast<int>(actual)).ToLocal(&data)||!out->SetPrototypeV2(context,v8::Null(isolate)).FromMaybe(false)||!out->CreateDataProperty(context,Text(isolate,"state"),v8::Integer::New(isolate,state)).FromMaybe(false)||!out->CreateDataProperty(context,Text(isolate,"data"),data).FromMaybe(false)||!out->SetIntegrityLevel(context,v8::IntegrityLevel::kFrozen).FromMaybe(false))return;
 args.GetReturnValue().Set(out);
}
static void BrokerPortWrite(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()!=1||!BrokerPortPositive(row)||!row->launched||row->exited||!args[0]->IsUint8Array()||args[0]->IsProxy())return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 auto bytes=args[0].As<v8::Uint8Array>();size_t size=bytes->ByteLength();if(!size||size>65536)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_WRITE_SIZE");
 unsigned char input[65536];if(bytes->CopyContents(input,sizeof(input))!=size)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_WRITE_SIZE");uint32_t actual=0;
 if(!nm_broker_child_write_business(row->birth,input,static_cast<uint32_t>(size),&actual))return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_WRITE_HELD");args.GetReturnValue().Set(v8::Integer::NewFromUnsigned(args.GetIsolate(),actual));
}
static void BrokerPortSignal(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()!=1||!row||!row->launch_entered||!args[0]->IsInt32())return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 if(!nm_broker_child_signal_owned(row->birth,args[0].As<v8::Int32>()->Value()))return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_SIGNAL_HELD");
}
static void BrokerPortJoin(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()||!row||!row->launch_entered||!row->exited)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 if(!nm_broker_child_wait_owned(row->birth))return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_PHYSICAL_HELD");row->joined=true;
}
static void BrokerPortCancel(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* row=BrokerPort(args);if(args.Length()||!row||row->launch_entered)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 if(!nm_broker_child_cancel_unlaunched(row->birth))return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_CANCEL_HELD");row->joined=true;
}
[[maybe_unused]] static void CreateOriginalBrokerPort(const v8::FunctionCallbackInfo<v8::Value>& args){
 auto* capsule=OriginalInstallation(args);if(!capsule)return;auto* owner=State(args);nm_broker_child_birth* birth=nullptr;const v8::Local<v8::Value> issuer=args[0];
 if(!PrepareBrokerChild(capsule,owner,issuer,&birth)||!birth)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CORE_SOURCE_REQUIRED");
 #if defined(NR_MAIN_INSTALLATION_COMPONENT) && defined(NR_BROKER_PORT_ALLOCATION_FAULT)
 auto* row=static_cast<BrokerParentPort*>(nullptr);
#else
 auto* row=new(std::nothrow) BrokerParentPort{};
#endif
 if(!row)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_ALLOCATION_HELD");
 row->next=broker_parent_ports;broker_parent_ports=row;row->installation=capsule;row->owner=owner;row->birth=birth;row->environment=owner->env;row->thread=uv_thread_self();auto* isolate=args.GetIsolate();auto context=isolate->GetCurrentContext();row->context.Reset(isolate,context);auto object=v8::Object::New(isolate);row->object.Reset(isolate,object);
 if(!object->SetPrototypeV2(context,v8::Null(isolate)).FromMaybe(false))return;auto data=v8::External::New(isolate,row);
 for(const auto& entry:{std::pair{"launch",&BrokerPortLaunch},std::pair{"poll",&BrokerPortPoll},std::pair{"read",&BrokerPortRead},std::pair{"write",&BrokerPortWrite},std::pair{"signal",&BrokerPortSignal},std::pair{"join",&BrokerPortJoin},std::pair{"cancel",&BrokerPortCancel}}){
  v8::Local<v8::Function> fn;if(!v8::Function::New(context,entry.second,data).ToLocal(&fn)||!fn->SetIntegrityLevel(context,v8::IntegrityLevel::kFrozen).FromMaybe(false)||!object->CreateDataProperty(context,Text(isolate,entry.first),fn).FromMaybe(false))return;
 }
 if(!object->SetIntegrityLevel(context,v8::IntegrityLevel::kFrozen).FromMaybe(false))return;args.GetReturnValue().Set(object);
}

[[maybe_unused]] static void AssertOriginalBrokerPort(const v8::FunctionCallbackInfo<v8::Value>& args){
 if(args.Length()!=1)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 for(auto* row=broker_parent_ports;row;row=row->next)if(!row->object.IsEmpty()&&row->object.Get(args.GetIsolate())==args[0]&&BrokerPortContext(row,args.GetIsolate()))return;
 Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
}

[[maybe_unused]] static void AssertOriginalBrokerPortTerminal(const v8::FunctionCallbackInfo<v8::Value>& args){
 if(args.Length()!=1)return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
 for(auto* row=broker_parent_ports;row;row=row->next)if(!row->object.IsEmpty()&&row->object.Get(args.GetIsolate())==args[0]&&BrokerPortContext(row,args.GetIsolate())){
  if(row->joined&&nm_broker_child_assert_terminal(row->birth))return;
  return Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_PHYSICAL_HELD");
 }
 Throw(args.GetIsolate(),"BROKER_ORIGINAL_CHILD_REQUIRED");
}
