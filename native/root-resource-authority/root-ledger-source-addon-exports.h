/* Separate Node-API8 Source: no Main session, issuer or mutation is exported. */
NAPI_MODULE_INIT(){
#ifdef __APPLE__
 const napi_property_descriptor methods[]={
  {"captureExistingOriginalRootPoolLedger",NULL,capture_existing_root_pool_ledger,NULL,NULL,NULL,napi_default,NULL},
  {"closeOriginalRootPoolLedgerSource",NULL,close_root_pool_ledger_source,NULL,NULL,NULL,napi_default,NULL},
 };
 if(napi_define_properties(env,exports,sizeof(methods)/sizeof(*methods),methods)!=napi_ok||napi_object_freeze(env,exports)!=napi_ok)return fail(env,"ROOT_LEDGER_SOURCE_EXPORT_UNAVAILABLE");
 return exports;
#else
 return fail(env,"ROOT_RESOURCE_PLATFORM_UNAVAILABLE");
#endif
}
