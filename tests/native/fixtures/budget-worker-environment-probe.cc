// Component-only fixed SDK observation. This addon issues no role/IO/lease.
#include <node.h>
#include <uv.h>
namespace node { namespace binding { void GetInternalBinding(const v8::FunctionCallbackInfo<v8::Value>&); } }
namespace {
using namespace v8;
struct Row {Isolate* isolate;Global<Context> context;Global<Value> raw;};
void clean(void* value){auto* row=static_cast<Row*>(value);row->raw.Reset();row->context.Reset();delete row;}
Local<String> str(Isolate* i,const char* p){return String::NewFromUtf8(i,p).ToLocalChecked();}
void inspect(const FunctionCallbackInfo<Value>& args){
 auto* i=args.GetIsolate();auto c=i->GetCurrentContext();
 if(args.Length()!=0){i->ThrowException(Exception::Error(str(i,"EXACT_ZERO_ARGUMENTS")));return;}
 auto* row=new Row{i,Global<Context>(i,c),Global<Value>()};node::AddEnvironmentCleanupHook(i,clean,row);
 Local<Function> fn;Local<Value> raw;Local<Value> input[]={str(i,"worker")};
 if(!Function::New(c,node::binding::GetInternalBinding).ToLocal(&fn)||!fn->Call(c,Undefined(i),1,input).ToLocal(&raw))return;
 row->raw.Reset(i,raw);
 if(!raw->IsObject()||raw->IsProxy()){i->ThrowException(Exception::Error(str(i,"NATIVE_WORKER_BINDING_REQUIRED")));return;}
 Local<Value> idDescriptor,mainDescriptor,id,main;
 if(!raw.As<Object>()->GetOwnPropertyDescriptor(c,str(i,"threadId")).ToLocal(&idDescriptor)||!idDescriptor->IsObject()||
    !raw.As<Object>()->GetOwnPropertyDescriptor(c,str(i,"isMainThread")).ToLocal(&mainDescriptor)||!mainDescriptor->IsObject()||
    !idDescriptor.As<Object>()->Get(c,str(i,"value")).ToLocal(&id)||!id->IsNumber()||
    !mainDescriptor.As<Object>()->Get(c,str(i,"value")).ToLocal(&main)||!main->IsBoolean()){
  i->ThrowException(Exception::Error(str(i,"NATIVE_WORKER_DATA_REQUIRED")));return;
 }
 auto out=Object::New(i);out->CreateDataProperty(c,str(i,"nativeThreadId"),id).Check();out->CreateDataProperty(c,str(i,"nativeIsMainThread"),main).Check();
 out->CreateDataProperty(c,str(i,"hasOriginalEnvironment"),Boolean::New(i,node::GetCurrentEnvironment(c)!=nullptr)).Check();
 out->CreateDataProperty(c,str(i,"productionQualified"),False(i)).Check();args.GetReturnValue().Set(out);
}
NODE_MODULE_INIT(){NODE_SET_METHOD(exports,"inspectOriginalWorkerEnvironment",inspect);}
}
