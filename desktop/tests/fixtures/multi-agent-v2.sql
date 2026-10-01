-- Frozen v2 DDL from the installed Desktop database; schema only, no user rows.
CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id));
CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')));
CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id));
CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id));
CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0, delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted')), delete_json TEXT, pending_approval_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0));
CREATE TABLE workspace_execution_authorizations (
  profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  permission_revision INTEGER NOT NULL CHECK (typeof(permission_revision) = 'integer' AND permission_revision BETWEEN 0 AND 9007199254740991),
  execution_allowed INTEGER NOT NULL CHECK (execution_allowed IN (0, 1)), updated_at INTEGER NOT NULL, actor_id TEXT,
  last_receipt_json TEXT CHECK (last_receipt_json IS NULL OR json_valid(last_receipt_json)), PRIMARY KEY (profile_id, workspace_id));
CREATE INDEX agents_page ON agents(group_id,created_at,agent_id);
CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL;
CREATE INDEX groups_page ON groups(thread_id,created_at,group_id);
CREATE INDEX messages_claim ON messages(group_id,claim_id);
CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at);
CREATE INDEX operations_approval_requests ON operations (
  group_id, json_extract(data_json, '$.result.approval.bootId'), operation_id) WHERE json_extract(data_json, '$.command') = 'approval_request';
CREATE INDEX root_turns_boot ON root_turns(boot_id);
PRAGMA user_version=2;
