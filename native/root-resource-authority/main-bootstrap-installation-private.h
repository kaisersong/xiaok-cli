/* Same original translation unit, exact contiguous function group. Not a public header. */
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
int PrepareKSwarmChild(const nm_installation_handoff* table,const void* issuer_slot,const void* environment,nm_kswarm_child_birth** out){
 auto* c=Capsule(table);if(!c||!issuer_slot||!out||!c->owner||c->owner->env!=environment||!SameContext(c->owner)||c->owner->closing||c->owner->revoked||c->owner->failed)return 0;
 const auto value=*static_cast<const v8::Local<v8::Value>*>(issuer_slot);if(!Member(c->owner,value)||c->owner->installation_issuer.IsEmpty()||c->owner->installation_issuer.Get(c->owner->isolate)!=value)return 0;
 bool role=MainPrecheck(c->owner);
#ifdef NR_MAIN_INSTALLATION_COMPONENT
 role=role||c->owner->component_core;
#endif
 return role&&nm_installed_prepare_core_kswarm_child(c->client,out);
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
  c->next=installations;c->owner=state;c->table={NM_HANDOFF_MAGIC,NM_HANDOFF_VERSION,sizeof(nm_installation_handoff),MI_BUILD_KIND,BorrowInstallation,InstallationCurrent,InstallationPing,InstallationClose,InstallationFate,BorrowRootStore,nm_installed_root_store_dispatch(),RootStoreCloseReady,PrepareBudgetWorker,nm_original_budget_worker_dispatch(),PrepareAdmissionStore,PrepareKSwarmChild,nm_original_kswarm_child_dispatch(),ReleaseInstallation};
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
