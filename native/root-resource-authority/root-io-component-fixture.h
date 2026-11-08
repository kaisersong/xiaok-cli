static napi_value component_bootstrap_installed_root_store(napi_env env,napi_callback_info info){
 napi_value args[1];if(!arguments(env,info,0,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
 nm_installed_client *client=nm_installed_create();nr_session *s=calloc(1,sizeof(*s));
 if(!client||!s)return fail(env,"ROOT_RESOURCE_NATIVE_ALLOCATION_FAILED");
 s->directory=s->lock_fd=-1;s->birth_pid=getpid();s->owner_env=env;s->component_client=client;s->next=sessions;sessions=s;
 if(!nm_installed_connect(client)||!nm_installed_borrow_root_store(client,&s->root_io)||
    !nr_root_store_read_identity(s->root_io,&s->io_identity))return fail(env,"COMPONENT_ROOT_IO_BIRTH_UNCONFIRMED");
 int original_birth=s->io_identity.birth_state;
 if(original_birth==NR_CREATED){
  if(!nr_root_store_claim_fresh(s->root_io,&s->io_claim)||!nr_root_store_read_claim(s->root_io,s->io_claim,&s->io_identity))return fail(env,"COMPONENT_ROOT_IO_CLAIM_UNCONFIRMED");
  s->created_db=s->created_lock=1;
 }
 if(nr_original_root_vfs_create(s->root_io,&s->root_vfs)!=SQLITE_OK||nr_original_root_vfs_open(s->root_vfs,&s->db)!=SQLITE_OK||!current(s))return fail(env,"COMPONENT_ROOT_IO_OPEN_UNCONFIRMED");
 if(sqlite3_db_config(s->db,SQLITE_DBCONFIG_DEFENSIVE,1,NULL)!=SQLITE_OK||sqlite3_db_config(s->db,SQLITE_DBCONFIG_TRUSTED_SCHEMA,0,NULL)!=SQLITE_OK||
    sqlite3_create_function_v2(s->db,nr_guard_name(s),-1,SQLITE_UTF8|SQLITE_INNOCUOUS,s,guard,NULL,NULL,NULL)!=SQLITE_OK||
    !execute(s,"PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL")||sqlite3_set_authorizer(s->db,authorizer,s)!=SQLITE_OK)return fail(env,"COMPONENT_ROOT_IO_SQL_UNCONFIRMED");
 napi_value private_session=object(env);if(!private_session||napi_type_tag_object(env,private_session,&session_tag)!=napi_ok||napi_wrap(env,private_session,s,finalize,NULL,NULL)!=napi_ok)return fail(env,"COMPONENT_ROOT_IO_PRIVATE_SESSION_UNCONFIRMED");
 sqlite3_int64 count=-1;if(!scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count))return fail(env,"COMPONENT_ROOT_IO_SCHEMA_UNCONFIRMED");
 if(count==0){
  if(!s->io_claim)return fail(env,"COMPONENT_ROOT_IO_NO_FRESH_CLAIM");
  /* Invoke the actual production callback with a real N-API callback frame.
   * No algorithm/SQL is reimplemented by the component. */
  napi_value fn,receiver,result;if(napi_create_function(env,"originalInstallFresh",NAPI_AUTO_LENGTH,install_fresh,NULL,&fn)!=napi_ok||napi_get_undefined(env,&receiver)!=napi_ok||napi_call_function(env,receiver,fn,1,&private_session,&result)!=napi_ok)return NULL;
 }
 int migrated=0;
 if(count!=0&&!floor_valid(s)&&floor_match(s,NR_PROFILE,NR_DIGEST,NR_GUARD,NR_SCHEMA_VERSION)){
  if(!nr_pool_migrate_original_v7(env,s))return NULL;
  migrated=1;
 }
 if(!nr_pool_graph(env,s)||(!migrated&&(count==0?!nr_pool_bind_protected(s,NR_FRESH_COMMIT):!nr_pool_restore_protected_binding(s))))return fail(env,"COMPONENT_ROOT_IO_GRAPH_UNCONFIRMED");

#ifdef MI_FIXTURE_AUTHORITY_SCOPES
 nr_root_store_io *other=NULL;unsigned char scope[32];memset(scope,0x11,sizeof(scope));
 if(!nm_fixture_borrow_authority_store(client,MI_FAMILY_ADMISSION,scope,&other))return fail(env,"COMPONENT_AUTHORITY_BIRTH_UNCONFIRMED");
 nr_root_store_identity other_identity;const nr_root_bootstrap_claim *other_claim=NULL;
 if(!nr_root_store_read_identity(other,&other_identity))return fail(env,"COMPONENT_AUTHORITY_IDENTITY_UNCONFIRMED");
 if(other_identity.birth_state==NR_CREATED&&(!nr_root_store_claim_fresh(other,&other_claim)||!nr_root_store_read_claim(other,other_claim,&other_identity)))return fail(env,"COMPONENT_AUTHORITY_CLAIM_UNCONFIRMED");
 nr_original_root_vfs *other_vfs=NULL;sqlite3 *other_db=NULL;
 if(nr_original_root_vfs_create(other,&other_vfs)!=SQLITE_OK||nr_original_root_vfs_open(other_vfs,&other_db)!=SQLITE_OK)return fail(env,"COMPONENT_AUTHORITY_OPEN_UNCONFIRMED");
 sqlite3 *same=s->db;sqlite3_int64 floor_count=0;
 if(release(s)||s->db!=same||s->closed||s->unknown||!scalar(s->db,"SELECT count(*) FROM root_resource_floor",&floor_count)||floor_count!=1)return fail(env,"COMPONENT_ROOT_CLOSED_BEFORE_AUTHORITY");
 if(sqlite3_exec(other_db,"CREATE TABLE IF NOT EXISTS component_evidence(id INTEGER PRIMARY KEY);INSERT OR IGNORE INTO component_evidence VALUES(1);",NULL,NULL,NULL)!=SQLITE_OK)return fail(env,"COMPONENT_AUTHORITY_SQL_UNCONFIRMED");
 if(nr_original_root_vfs_close(other_vfs,&other_db)!=NR_SQL_FILES_CLOSED)return fail(env,"COMPONENT_AUTHORITY_CLOSE_UNCONFIRMED");
#endif
 enum nr_root_adoption_kind adopted_kind;
 if(!nr_root_store_read_adoption_kind(s->root_io,&adopted_kind))return fail(env,"COMPONENT_ADOPTION_KIND_UNCONFIRMED");
 if(adopted_kind==NR_ROOT_ADOPTED_BINDING){
  const nr_root_bootstrap_claim *wrong=NULL;nr_root_store_identity rejected;nr_original_pool_history history;
  if(nr_root_store_claim_fresh(s->root_io,&wrong)||nr_root_store_read_claim(s->root_io,s->io_claim,&rejected)||
     nr_root_store_read_adoption(s->root_io,(const nr_root_bootstrap_claim *)s,&history,&rejected))return fail(env,"COMPONENT_ADOPTION_FOREIGN_ACCEPTED");
 }
 nr_root_store_identity identity=s->io_identity;char pool[65];nr_hex32(identity.pool_id,pool);
 napi_value out=object(env);if(!out||!text(env,out,"poolId",pool)||!text(env,out,"profile",nr_profile(s))||!number(env,out,"schemaVersion",nr_schema_version(s))||!boolean(env,out,"fresh",count==0)||!boolean(env,out,"restored",count!=0)||!boolean(env,out,"productionQualified",0))return fail(env,"COMPONENT_ROOT_IO_METADATA_UNCONFIRMED");
 if(!release(s)||!nm_installed_close_owned(client))return fail(env,"COMPONENT_ROOT_IO_CLOSE_UNCONFIRMED");
 if(adopted_kind==NR_ROOT_ADOPTED_BINDING){
  nr_original_pool_history history;nr_root_store_identity rejected;enum nr_root_adoption_kind kind;
  if(nr_root_store_read_adoption_kind(s->root_io,&kind)||nr_root_store_read_adoption(s->root_io,s->io_claim,&history,&rejected))return fail(env,"COMPONENT_ADOPTION_RELEASED_ACCEPTED");
 }
 nm_installed_fate fate;if(!nm_installed_fate_read(client,&fate)||!fate.root_files_closed||fate.unknown)return fail(env,"COMPONENT_ROOT_IO_CLOSE_UNCONFIRMED");
#ifdef MI_FIXTURE_AUTHORITY_SCOPES
 boolean(env,out,"rootCloseBeforeSqlBusy",1);boolean(env,out,"rootSameSqlHandleAfterBusy",1);boolean(env,out,"authorityPhysicallyClosed",1);
#endif
 boolean(env,out,"rootFilesClosed",fate.root_files_closed);boolean(env,out,"unknown",fate.unknown);return out;
}