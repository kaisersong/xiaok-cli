#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
napi_value nr_init_resource_authority(napi_env env,napi_value exports){
#else
NAPI_MODULE_INIT(){
#endif
 const napi_property_descriptor methods[]={
  {"buildInfo",NULL,build_info,NULL,NULL,NULL,napi_default,NULL},
  {"openOriginal",NULL,open_original,NULL,NULL,NULL,napi_default,NULL},
  {"installFresh",NULL,install_fresh,NULL,NULL,NULL,napi_default,NULL},
  {"readPolicy",NULL,read_policy,NULL,NULL,NULL,napi_default,NULL},
  {"close",NULL,close_session,NULL,NULL,NULL,napi_default,NULL},
  {"enqueue",NULL,enqueue_resource,NULL,NULL,NULL,napi_default,NULL},
  {"claimNext",NULL,claim_resource,NULL,NULL,NULL,napi_default,NULL},
  {"consumeLaunch",NULL,consume_resource,NULL,NULL,NULL,napi_default,NULL},
  {"finishOriginalRoot",NULL,finish_original_root,NULL,NULL,NULL,napi_default,NULL},
  {"readRecord",NULL,read_resource,NULL,NULL,NULL,napi_default,NULL},
  {"cancelQueued",NULL,cancel_queued_resource,NULL,NULL,NULL,napi_default,NULL},
#if defined(__APPLE__) && defined(NR_FIXTURE_BUILD) && defined(NR_FIXTURE_FACTS_HEADER)
  {"fixtureSubject",NULL,fixture_subject,NULL,NULL,NULL,napi_default,NULL},
  {"armCommitWrapperFailure",NULL,arm_commit_wrapper_failure,NULL,NULL,NULL,napi_default,NULL},
#ifdef NR_MAIN_BOOTSTRAP_EMBEDDED
  {"armProcessIntentWriteFailure",NULL,arm_process_intent_write_failure,NULL,NULL,NULL,napi_default,NULL},
#endif
  {"armPhysicalWriteMismatch",NULL,arm_physical_write_mismatch,NULL,NULL,NULL,napi_default,NULL},
#endif
 };
 if(napi_define_properties(env,exports,sizeof(methods)/sizeof(*methods),methods)!=napi_ok)return fail(env,"ROOT_RESOURCE_EXPORT_UNAVAILABLE");
#if defined(__APPLE__) && defined(NR_MAIN_BOOTSTRAP_EMBEDDED)
 nr_main_addon *addon=calloc(1,sizeof(*addon));if(!addon)return fail(env,"ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");
 addon->env=env;
 napi_value shape;napi_valuetype shape_type;
 if(napi_get_named_property(env,exports,"__originalModelSdkPortShape",&shape)!=napi_ok||
    napi_typeof(env,shape,&shape_type)!=napi_ok||shape_type!=napi_function||
    napi_create_reference(env,shape,1,&addon->model_sdk_shape)!=napi_ok){free(addon);return fail(env,"ROOT_RESOURCE_MODEL_BRIDGE_SHAPE_UNAVAILABLE");}
 if(napi_get_named_property(env,exports,"__originalMainInstallationAdopt",&shape)!=napi_ok||napi_typeof(env,shape,&shape_type)!=napi_ok||shape_type!=napi_function||napi_create_reference(env,shape,1,&addon->installation_adopt)!=napi_ok){napi_delete_reference(env,addon->model_sdk_shape);free(addon);return fail(env,"ROOT_RESOURCE_INSTALLATION_ADOPTION_UNAVAILABLE");}
 addon->bridge=nr_main_bridge_create(env,addon);
 if(!addon->bridge){napi_delete_reference(env,addon->model_sdk_shape);napi_delete_reference(env,addon->installation_adopt);free(addon);return fail(env,"ROOT_RESOURCE_MAIN_BRIDGE_UNAVAILABLE");}
 if(napi_add_env_cleanup_hook(env,main_env_cleanup,addon)!=napi_ok){main_env_cleanup(addon);return fail(env,"ROOT_RESOURCE_MAIN_CLEANUP_UNAVAILABLE");}
 const napi_property_descriptor main_methods[]={
#if defined(MI_FIXTURE_BUILD) && defined(NR_ROOT_IO_COMPONENT)
  {"componentBootstrapInstalledRootStore",NULL,component_bootstrap_installed_root_store,NULL,NULL,NULL,napi_default,addon},
#endif
  {"adoptOriginalMainInstallation",NULL,adopt_main_installation,NULL,NULL,NULL,napi_default,addon},
#ifdef NR_FIXTURE_BUILD
  {"fixtureSeedMigrationPhysicalHistory",NULL,fixture_seed_migration_physical_history,NULL,NULL,NULL,napi_default,addon},
  {"fixtureValidateOrdinaryV7History",NULL,fixture_validate_ordinary_v7_history,NULL,NULL,NULL,napi_default,addon},
  {"fixtureHoldSchemaReference",NULL,fixture_hold_schema_reference,NULL,NULL,NULL,napi_default,addon},
  {"armPoolBootstrapFailure",NULL,arm_pool_bootstrap_failure,NULL,NULL,NULL,napi_default,addon},
#endif
  {"readOriginalRootPoolLedger",NULL,read_original_root_pool_ledger,NULL,NULL,NULL,napi_default,addon},
  {"captureExistingOriginalRootPoolLedger",NULL,capture_existing_root_pool_ledger,NULL,NULL,NULL,napi_default,addon},
  {"closeOriginalRootPoolLedgerSource",NULL,close_root_pool_ledger_source,NULL,NULL,NULL,napi_default,addon},
  {"readOriginalMainPoolBootstrap",NULL,read_original_main_pool_bootstrap,NULL,NULL,NULL,napi_default,addon},
  {"sealOriginalMainRootBusiness",NULL,seal_original_main_root_business,NULL,NULL,NULL,napi_default,addon},
  {"bootstrapOriginalMainPool",NULL,bootstrap_original_main_pool,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalModelSdkBridgeKey",NULL,take_model_sdk_bridge_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalModelSdkBridge",NULL,assert_model_sdk_bridge,NULL,NULL,NULL,napi_default,addon},
  {"openOriginalInstalledMainIssuer",NULL,open_installed_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"openOriginalMainIssuer",NULL,open_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalMainIssuerCurrent",NULL,assert_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"revokeOriginalMainIssuer",NULL,revoke_main_issuer,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalRoomTurnSubject",NULL,import_room_subject,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalRoomDiscussionSourceKey",NULL,take_room_discussion_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalRoomDiscussionSourceKey",NULL,assert_room_discussion_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalRoomProjectSourceKey",NULL,take_room_project_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalRoomProjectSourceKey",NULL,assert_room_project_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalKSwarmDirectSourceKey",NULL,take_kswarm_direct_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalKSwarmDirectSourceKey",NULL,assert_kswarm_direct_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalDshDraftSourceKey",NULL,take_dsh_draft_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalDshDraftSourceKey",NULL,assert_dsh_draft_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalMainTurnSourceKey",NULL,take_main_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalGoalTurnSourceKey",NULL,take_goal_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalAdmissionProbeSourceKey",NULL,take_admission_probe_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalLivePreviewSourceKey",NULL,take_live_preview_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalNestedSubagentSourceKey",NULL,take_nested_subagent_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalSnapshotPrepSourceKey",NULL,take_snapshot_prep_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalToolWorkerSourceKey",NULL,take_tool_worker_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalMaterialTurnSourceKey",NULL,take_material_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalCanvasTurnSourceKey",NULL,take_canvas_turn_source_key,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalPhysicalContext",NULL,import_physical_context,NULL,NULL,NULL,napi_default,addon},
#ifdef NR_HAS_FIXTURE_FACTS
  {"fixtureReadPhysicalSnapshot",NULL,fixture_physical_snapshot,NULL,NULL,NULL,napi_default,addon},
#endif
  {"enqueueOriginalModel",NULL,enqueue_original_model,NULL,NULL,NULL,napi_default,addon},
  {"claimOriginalModel",NULL,claim_original_model,NULL,NULL,NULL,napi_default,addon},
  {"settleOriginalModel",NULL,settle_original_model,NULL,NULL,NULL,napi_default,addon},
  {"enqueueOriginalProcess",NULL,enqueue_original_process,NULL,NULL,NULL,napi_default,addon},
  {"enqueueOriginalWorkflowVmProcess",NULL,enqueue_original_workflow_vm_process,NULL,NULL,NULL,napi_default,addon},
  {"claimOriginalProcess",NULL,claim_original_process,NULL,NULL,NULL,napi_default,addon},
  {"prepareOriginalReadonlyLeaf",NULL,prepare_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"waitOriginalReadonlyLeafReady",NULL,wait_original_readonly_leaf_ready,NULL,NULL,NULL,napi_default,addon},
  {"bindOriginalReadonlyLeaf",NULL,bind_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"goOriginalReadonlyLeaf",NULL,go_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"cancelOriginalReadonlyLeaf",NULL,cancel_original_readonly_leaf,NULL,NULL,NULL,napi_default,addon},
  {"waitOriginalReadonlyLeafClosed",NULL,wait_original_readonly_leaf_closed,NULL,NULL,NULL,napi_default,addon},
  {"readOriginalProcessIntent",NULL,read_original_process_intent,NULL,NULL,NULL,napi_default,addon},
  {"readOriginalProcessHistory",NULL,read_original_process_history,NULL,NULL,NULL,napi_default,addon},
  {"settleOriginalProcess",NULL,settle_original_process,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalKSwarmTaskSubject",NULL,import_kswarm_task_subject,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalRoomProjectSubject",NULL,import_room_project_subject,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalWorkflowRootSubject",NULL,import_workflow_root_subject,NULL,NULL,NULL,napi_default,addon},
  {"importOriginalDshDraftSubject",NULL,import_dsh_subject,NULL,NULL,NULL,napi_default,addon},
  {"takeOriginalWorkflowRootSourceKey",NULL,take_workflow_root_source_key,NULL,NULL,NULL,napi_default,addon},
  {"assertOriginalWorkflowRootSourceKey",NULL,assert_workflow_root_source_key,NULL,NULL,NULL,napi_default,addon}
 };
 if(napi_define_properties(env,exports,sizeof(main_methods)/sizeof(*main_methods),main_methods)!=napi_ok)return fail(env,"ROOT_RESOURCE_EXPORT_UNAVAILABLE");
#endif
 return exports;
}
