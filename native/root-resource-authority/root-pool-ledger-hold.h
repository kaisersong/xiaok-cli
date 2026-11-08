/* One original Source row stays held; none of these members grants N/M/P. */
typedef struct nr_ledger_hold {
 struct nr_ledger_hold *next;nr_ledger_source *source;napi_env env;napi_ref object;
 pid_t pid;struct stat database;nr_ledger_bytes initial;int closed,unknown;const char *first;
} nr_ledger_hold;
static _Thread_local nr_ledger_hold *nr_ledger_holds;
static void nr_ledger_hold_source_disposed(nr_ledger_source *r){
 for(nr_ledger_hold *h=nr_ledger_holds;h;h=h->next)if(h->source==r){h->source=NULL;h->closed=1;}
}
static void nr_ledger_hold_cleanup(void *raw){
 nr_ledger_hold *h=raw;
 /* The original Source cleanup hook was registered later and runs first.
  * Unknown original sources retain their row and this delivery reference. */
 if(h->source)return;
 nr_ledger_hold **slot=&nr_ledger_holds;while(*slot&&*slot!=h)slot=&(*slot)->next;if(*slot)*slot=h->next;
 nr_ledger_clear(&h->initial);if(h->object)napi_delete_reference(h->env,h->object);free(h);
}
static nr_ledger_hold *nr_ledger_hold_member(napi_env env,napi_callback_info info){
 napi_value receiver,args[1];size_t argc=1;
 if(napi_get_cb_info(env,info,&argc,args,&receiver,NULL)!=napi_ok||argc){fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");return NULL;}
 for(nr_ledger_hold *h=nr_ledger_holds;h;h=h->next){
  if(h->env!=env||h->pid!=getpid()||!h->object)continue;
  napi_value original;bool same=false;
  if(napi_get_reference_value(env,h->object,&original)==napi_ok&&napi_strict_equals(env,receiver,original,&same)==napi_ok&&same)return h;
 }
 fail(env,"ROOT_LEDGER_HOLD_REQUIRED");return NULL;
}
static int nr_ledger_hold_current(nr_ledger_hold *h){
 if(h->closed||!h->source||h->unknown)return 0;
 nr_ledger_bytes observed={0};const char *error="ROOT_LEDGER_SOURCE_STALE";
 struct stat actual;
 int good=!fstat(h->source->probe,&actual)&&actual.st_size==h->database.st_size&&actual.st_mtimespec.tv_sec==h->database.st_mtimespec.tv_sec&&actual.st_mtimespec.tv_nsec==h->database.st_mtimespec.tv_nsec&&actual.st_ctimespec.tv_sec==h->database.st_ctimespec.tv_sec&&actual.st_ctimespec.tv_nsec==h->database.st_ctimespec.tv_nsec&&nr_ledger_existing_current(&h->source->view)&&
  nr_ledger_capture(h->env,&h->source->view,"existing-ordinary-readonly",&observed,&error)&&
  observed.size==h->initial.size&&!memcmp(observed.bytes,h->initial.bytes,observed.size)&&nr_ledger_existing_current(&h->source->view);
 nr_ledger_clear(&observed);
 if(!good){h->unknown=1;if(!h->first)h->first=error;h->source->unknown=1;h->source->view.unknown=1;}
 return good;
}
static napi_value nr_ledger_hold_error(napi_env env,nr_ledger_hold *h){
 return fail(env,h->closed?"ROOT_LEDGER_HOLD_CLOSED":h->first?h->first:"ROOT_LEDGER_HOLD_UNCONFIRMED");
}
static napi_value nr_ledger_hold_read(napi_env env,napi_callback_info info){
 nr_ledger_hold *h=nr_ledger_hold_member(env,info);if(!h)return NULL;
 if(!nr_ledger_hold_current(h))return nr_ledger_hold_error(env,h);
 nr_ledger_bytes copy={0};
 if(!nr_ledger_append(&copy,h->initial.bytes,h->initial.size)){nr_ledger_clear(&copy);h->unknown=1;h->first="ROOT_LEDGER_PROJECTION_UNCONFIRMED";return nr_ledger_hold_error(env,h);}
 return nr_ledger_projection(env,&copy);
}
static napi_value nr_ledger_hold_check(napi_env env,napi_callback_info info){
 nr_ledger_hold *h=nr_ledger_hold_member(env,info);if(!h)return NULL;
 if(!nr_ledger_hold_current(h))return nr_ledger_hold_error(env,h);
 napi_value out;napi_get_undefined(env,&out);return out;
}
static napi_value nr_ledger_hold_close(napi_env env,napi_callback_info info){
 nr_ledger_hold *h=nr_ledger_hold_member(env,info);if(!h)return NULL;
 if(h->source&&!nr_ledger_source_done(env,h->source)){h->unknown=1;if(!h->first)h->first="ROOT_LEDGER_CLOSE_UNCONFIRMED";return nr_ledger_hold_error(env,h);}
 if(h->unknown)return nr_ledger_hold_error(env,h);
 h->closed=1;nr_ledger_clear(&h->initial);napi_value out;napi_get_undefined(env,&out);return out;
}
static napi_value nr_ledger_hold_assert_closed(napi_env env,napi_callback_info info){
 nr_ledger_hold *h=nr_ledger_hold_member(env,info);if(!h)return NULL;
 if(!h->closed||h->source||h->unknown)return fail(env,"ROOT_LEDGER_HOLD_NOT_CLOSED");
 napi_value out;napi_get_undefined(env,&out);return out;
}
#ifdef NR_FIXTURE_BUILD
/* Break the actual captured descriptor, never substitute a close verdict. */
static napi_value nr_ledger_hold_fixture_break_probe(napi_env env,napi_callback_info info){
 nr_ledger_hold *h=nr_ledger_hold_member(env,info);if(!h)return NULL;
 if(!h->source||h->source->probe<0||close(h->source->probe))return fail(env,"ROOT_LEDGER_FIXTURE_INVALID");
 napi_value out;napi_get_undefined(env,&out);return out;
}
#endif
static napi_value hold_existing_root_pool_ledger(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nr_ledger_hold *h=calloc(1,sizeof(*h));if(!h)return fail(env,"ROOT_LEDGER_ALLOCATION_FAILED");h->env=env;h->pid=getpid();
 if(napi_add_env_cleanup_hook(env,nr_ledger_hold_cleanup,h)!=napi_ok){free(h);return fail(env,"ROOT_LEDGER_CUSTODY_UNAVAILABLE");}
 h->next=nr_ledger_holds;nr_ledger_holds=h;const char *error="ROOT_LEDGER_SOURCE_UNCONFIRMED";
 int good=nr_ledger_existing_open(env,&h->source,&error);
 if(good)good=!fstat(h->source->probe,&h->database)&&h->database.st_size>=0;
 if(good)good=nr_ledger_capture(env,&h->source->view,"existing-ordinary-readonly",&h->initial,&error);
 if(!good){if(h->source&&!nr_ledger_source_done(env,h->source)){h->unknown=1;h->first=error;}return fail(env,error);}
 napi_value out=object(env);if(!out||napi_create_reference(env,out,1,&h->object)!=napi_ok){h->unknown=1;h->first="ROOT_LEDGER_PROJECTION_UNCONFIRMED";return fail(env,h->first);}
 const napi_property_descriptor methods[]={
  {"read",NULL,nr_ledger_hold_read,NULL,NULL,NULL,napi_default,NULL},
  {"check",NULL,nr_ledger_hold_check,NULL,NULL,NULL,napi_default,NULL},
  {"close",NULL,nr_ledger_hold_close,NULL,NULL,NULL,napi_default,NULL},
  {"assertClosed",NULL,nr_ledger_hold_assert_closed,NULL,NULL,NULL,napi_default,NULL},
#ifdef NR_FIXTURE_BUILD
  {"fixtureBreakProbe",NULL,nr_ledger_hold_fixture_break_probe,NULL,NULL,NULL,napi_default,NULL},
#endif
 };
 char size[32];snprintf(size,sizeof(size),"%llu",(unsigned long long)h->database.st_size);
 if(!text(env,out,"directoryPath",h->source->view.path)||!text(env,out,"databaseBytes",size)||napi_define_properties(env,out,sizeof(methods)/sizeof(*methods),methods)!=napi_ok||napi_object_freeze(env,out)!=napi_ok){h->unknown=1;h->first="ROOT_LEDGER_PROJECTION_UNCONFIRMED";return fail(env,h->first);}
 return out;
}
