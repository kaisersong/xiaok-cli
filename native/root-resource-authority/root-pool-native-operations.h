static const char *schema=
 "CREATE TABLE root_pool_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),identity_version INTEGER NOT NULL,pool_id TEXT NOT NULL,owner_uid INTEGER NOT NULL,directory_device INTEGER NOT NULL,directory_inode INTEGER NOT NULL,directory_mode INTEGER NOT NULL,lock_device INTEGER NOT NULL,lock_inode INTEGER NOT NULL,lock_mode INTEGER NOT NULL,database_device INTEGER NOT NULL,database_inode INTEGER NOT NULL,database_mode INTEGER NOT NULL);"
 "CREATE TABLE root_resource_floor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),profile TEXT NOT NULL,schema_version INTEGER NOT NULL,semantic_digest TEXT NOT NULL,guard_abi TEXT NOT NULL,issuer_epoch INTEGER NOT NULL);"
 "CREATE TABLE root_resource_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner_digest TEXT NOT NULL,issuer_json TEXT NOT NULL,capacity INTEGER NOT NULL,queue_limit INTEGER NOT NULL,next_seq INTEGER NOT NULL,human_burst INTEGER NOT NULL,claim_seq INTEGER NOT NULL);"
 "CREATE TABLE root_resources(record_id TEXT PRIMARY KEY,execution_key TEXT UNIQUE NOT NULL,metadata_json TEXT NOT NULL,metadata_digest TEXT NOT NULL,enqueue_seq INTEGER UNIQUE NOT NULL,revision INTEGER NOT NULL,generation INTEGER NOT NULL,issuer_epoch INTEGER NOT NULL,state TEXT NOT NULL,claim_token TEXT,attempt_id TEXT);"
 "CREATE INDEX root_resources_pending ON root_resources(state,enqueue_seq);"
 "CREATE TABLE root_launch_outbox(record_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,FOREIGN KEY(record_id) REFERENCES root_resources(record_id));"
 "CREATE TABLE root_resource_receipts(record_id TEXT NOT NULL,kind TEXT NOT NULL,binding_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(record_id,kind),FOREIGN KEY(record_id) REFERENCES root_resources(record_id));" NR_PHYSICAL_SCHEMA;
static const char *schema_io_binding=
 "CREATE TABLE root_pool_io_binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1),binding_version INTEGER NOT NULL,pool_id TEXT NOT NULL,namespace_id TEXT NOT NULL,birth_id TEXT NOT NULL,claim_id TEXT NOT NULL,anchor_digest TEXT NOT NULL,profile_digest TEXT NOT NULL,file_owner_uid INTEGER NOT NULL,directory_nlink INTEGER NOT NULL,lock_nlink INTEGER NOT NULL,database_nlink INTEGER NOT NULL,FOREIGN KEY(singleton) REFERENCES root_pool_identity(singleton));";
static napi_value install_fresh(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=effect_session(env,args[0]);if(!s)return NULL;
 sqlite3_int64 count;if(!scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count))return fail(env,"ROOT_RESOURCE_SCHEMA_UNCONFIRMED");if(count)return fail(env,"ROOT_RESOURCE_FRESH_REQUIRED");
 if(!s->created_lock||!s->created_db)return fail(env,"ROOT_RESOURCE_FRESH_BIRTH_REQUIRED");
 s->installing=1;s->writing=1;int began=execute(s,"BEGIN IMMEDIATE"),good=began;
 if(good)good=current(s)&&scalar(s->db,"SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",&count)&&count==0&&execute(s,schema)&&(!nr_protected(s)||execute(s,schema_io_binding));
 if(good)good=nr_create_guards(s)&&nr_install_rows(s);
 if(good)good=nr_verify_frame(s)&&floor_valid(s)&&current(s);
 if(good){good=execute(s,"COMMIT");if(!good)s->unknown=1;
#ifdef NR_FIXTURE_BUILD
  /* Actual COMMIT precedes this controlled SDK wrapper failure. */
  if(good&&s->fixture_bootstrap_failure==6){s->fixture_bootstrap_failure=0;s->unknown=1;good=0;}
#endif
 }
 else if(began&&!execute(s,"ROLLBACK"))s->unknown=1;
 s->installing=0;nr_clear_frame(s);
 if(!good||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALL_UNCONFIRMED");}
 napi_value out=object(env);if(!out||!boolean(env,out,"installed",1)||s->unknown||s->closed||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_INSTALL_UNCONFIRMED");}s->fresh_owner=1;return out;
}
static napi_value read_policy(napi_env env,napi_callback_info info){
 napi_value args[2];if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=session(env,args[0],0);if(!s)return NULL;if(!floor_valid(s))return fail(env,"ROOT_RESOURCE_FLOOR_REQUIRED");
 sqlite3_stmt *stmt=NULL;int good=sqlite3_prepare_v2(s->db,"SELECT capacity,queue_limit,next_seq,claim_seq,human_burst FROM root_resource_policy WHERE singleton=1",-1,&stmt,NULL)==SQLITE_OK;
 if(good)good=sqlite3_step(stmt)==SQLITE_ROW;
 napi_value out=object(env);const char *names[]={"capacity","queueLimit","enqueueSeq","claimSeq","humanBurst"};
 for(int i=0;good&&i<5;i++){sqlite3_int64 n=sqlite3_column_int64(stmt,i);good=sqlite3_column_type(stmt,i)==SQLITE_INTEGER&&n>=0&&n<=9007199254740991LL;if(good)number(env,out,names[i],n);}
 if(good)good=sqlite3_step(stmt)==SQLITE_DONE;if(stmt&&sqlite3_finalize(stmt)!=SQLITE_OK)good=0;
 if(!good||s->unknown||s->closed||!floor_valid(s)||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_POLICY_UNCONFIRMED");}number(env,out,"issuerEpoch",1);if(s->unknown||s->closed||!current(s)){s->unknown=1;return fail(env,"ROOT_RESOURCE_POLICY_UNCONFIRMED");}return out;
}
static napi_value close_session(napi_env env,napi_callback_info info){
 napi_value args[2],out;if(!arguments(env,info,1,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");nr_session *s=session(env,args[0],1);if(!s)return NULL;
 if(!release(s))return fail(env,"ROOT_RESOURCE_CLOSE_UNCONFIRMED");napi_get_undefined(env,&out);return out;
}
