import {dshAuthoritySchema} from '../multi-agent/dsh-admission-authority-data.js';
/** Exact schema facts captured through the original DesktopMultiAgentStore
 * constructor/base migration statements. Comparison data only, never executed. */
import {freezeCapturedData} from './captured-source-json.js';
import type {readProfileSqliteReaderSchema} from './profile-source-capture.js';
const schemaDefine=Object.defineProperty,schemaFreeze=Object.freeze;
const variants=freezeCapturedData([
  {
    "version": 1,
    "columns": 0,
    "schema": [
      {
        "type": "index",
        "name": "agents_page",
        "tbl_name": "agents",
        "sql": "CREATE INDEX agents_page ON agents(group_id,created_at,agent_id)"
      },
      {
        "type": "index",
        "name": "agents_presentation_ordinal",
        "tbl_name": "agents",
        "sql": "CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "groups_page",
        "tbl_name": "groups",
        "sql": "CREATE INDEX groups_page ON groups(thread_id,created_at,group_id)"
      },
      {
        "type": "index",
        "name": "messages_claim",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_claim ON messages(group_id,claim_id)"
      },
      {
        "type": "index",
        "name": "messages_receiver",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at)"
      },
      {
        "type": "index",
        "name": "operations_presentation_agent",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "operations_presentation_ordinal",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "root_turns_boot",
        "tbl_name": "root_turns",
        "sql": "CREATE INDEX root_turns_boot ON root_turns(boot_id)"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_1",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_2",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_boot_owners_1",
        "tbl_name": "boot_owners",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_contents_1",
        "tbl_name": "contents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_1",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_2",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_groups_1",
        "tbl_name": "groups",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_managed_resources_1",
        "tbl_name": "managed_resources",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_messages_1",
        "tbl_name": "messages",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_operations_1",
        "tbl_name": "operations",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_1",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_2",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_thread_bindings_1",
        "tbl_name": "thread_bindings",
        "sql": null
      },
      {
        "type": "table",
        "name": "agents",
        "tbl_name": "agents",
        "sql": "CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "boot_owners",
        "tbl_name": "boot_owners",
        "sql": "CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')))"
      },
      {
        "type": "table",
        "name": "contents",
        "tbl_name": "contents",
        "sql": "CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "events",
        "tbl_name": "events",
        "sql": "CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "groups",
        "tbl_name": "groups",
        "sql": "CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "managed_resources",
        "tbl_name": "managed_resources",
        "sql": "CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "messages",
        "tbl_name": "messages",
        "sql": "CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "operations",
        "tbl_name": "operations",
        "sql": "CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id))"
      },
      {
        "type": "table",
        "name": "root_turns",
        "tbl_name": "root_turns",
        "sql": "CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "thread_bindings",
        "tbl_name": "thread_bindings",
        "sql": "CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0)"
      }
    ]
  },
  {
    "version": 1,
    "columns": 1,
    "schema": [
      {
        "type": "index",
        "name": "agents_page",
        "tbl_name": "agents",
        "sql": "CREATE INDEX agents_page ON agents(group_id,created_at,agent_id)"
      },
      {
        "type": "index",
        "name": "agents_presentation_ordinal",
        "tbl_name": "agents",
        "sql": "CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "groups_page",
        "tbl_name": "groups",
        "sql": "CREATE INDEX groups_page ON groups(thread_id,created_at,group_id)"
      },
      {
        "type": "index",
        "name": "messages_claim",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_claim ON messages(group_id,claim_id)"
      },
      {
        "type": "index",
        "name": "messages_receiver",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at)"
      },
      {
        "type": "index",
        "name": "operations_presentation_agent",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "operations_presentation_ordinal",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "root_turns_boot",
        "tbl_name": "root_turns",
        "sql": "CREATE INDEX root_turns_boot ON root_turns(boot_id)"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_1",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_2",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_boot_owners_1",
        "tbl_name": "boot_owners",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_contents_1",
        "tbl_name": "contents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_1",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_2",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_groups_1",
        "tbl_name": "groups",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_managed_resources_1",
        "tbl_name": "managed_resources",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_messages_1",
        "tbl_name": "messages",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_operations_1",
        "tbl_name": "operations",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_1",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_2",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_thread_bindings_1",
        "tbl_name": "thread_bindings",
        "sql": null
      },
      {
        "type": "table",
        "name": "agents",
        "tbl_name": "agents",
        "sql": "CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "boot_owners",
        "tbl_name": "boot_owners",
        "sql": "CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')))"
      },
      {
        "type": "table",
        "name": "contents",
        "tbl_name": "contents",
        "sql": "CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "events",
        "tbl_name": "events",
        "sql": "CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "groups",
        "tbl_name": "groups",
        "sql": "CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "managed_resources",
        "tbl_name": "managed_resources",
        "sql": "CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "messages",
        "tbl_name": "messages",
        "sql": "CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "operations",
        "tbl_name": "operations",
        "sql": "CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id))"
      },
      {
        "type": "table",
        "name": "root_turns",
        "tbl_name": "root_turns",
        "sql": "CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "thread_bindings",
        "tbl_name": "thread_bindings",
        "sql": "CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0, delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted')))"
      }
    ]
  },
  {
    "version": 1,
    "columns": 2,
    "schema": [
      {
        "type": "index",
        "name": "agents_page",
        "tbl_name": "agents",
        "sql": "CREATE INDEX agents_page ON agents(group_id,created_at,agent_id)"
      },
      {
        "type": "index",
        "name": "agents_presentation_ordinal",
        "tbl_name": "agents",
        "sql": "CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "groups_page",
        "tbl_name": "groups",
        "sql": "CREATE INDEX groups_page ON groups(thread_id,created_at,group_id)"
      },
      {
        "type": "index",
        "name": "messages_claim",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_claim ON messages(group_id,claim_id)"
      },
      {
        "type": "index",
        "name": "messages_receiver",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at)"
      },
      {
        "type": "index",
        "name": "operations_presentation_agent",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "operations_presentation_ordinal",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "root_turns_boot",
        "tbl_name": "root_turns",
        "sql": "CREATE INDEX root_turns_boot ON root_turns(boot_id)"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_1",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_2",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_boot_owners_1",
        "tbl_name": "boot_owners",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_contents_1",
        "tbl_name": "contents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_1",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_2",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_groups_1",
        "tbl_name": "groups",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_managed_resources_1",
        "tbl_name": "managed_resources",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_messages_1",
        "tbl_name": "messages",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_operations_1",
        "tbl_name": "operations",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_1",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_2",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_thread_bindings_1",
        "tbl_name": "thread_bindings",
        "sql": null
      },
      {
        "type": "table",
        "name": "agents",
        "tbl_name": "agents",
        "sql": "CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "boot_owners",
        "tbl_name": "boot_owners",
        "sql": "CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')))"
      },
      {
        "type": "table",
        "name": "contents",
        "tbl_name": "contents",
        "sql": "CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "events",
        "tbl_name": "events",
        "sql": "CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "groups",
        "tbl_name": "groups",
        "sql": "CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "managed_resources",
        "tbl_name": "managed_resources",
        "sql": "CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "messages",
        "tbl_name": "messages",
        "sql": "CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "operations",
        "tbl_name": "operations",
        "sql": "CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id))"
      },
      {
        "type": "table",
        "name": "root_turns",
        "tbl_name": "root_turns",
        "sql": "CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "thread_bindings",
        "tbl_name": "thread_bindings",
        "sql": "CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0, delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted')), delete_json TEXT)"
      }
    ]
  },
  {
    "version": 2,
    "schema": [
      {
        "type": "index",
        "name": "agents_page",
        "tbl_name": "agents",
        "sql": "CREATE INDEX agents_page ON agents(group_id,created_at,agent_id)"
      },
      {
        "type": "index",
        "name": "agents_presentation_ordinal",
        "tbl_name": "agents",
        "sql": "CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "groups_page",
        "tbl_name": "groups",
        "sql": "CREATE INDEX groups_page ON groups(thread_id,created_at,group_id)"
      },
      {
        "type": "index",
        "name": "messages_claim",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_claim ON messages(group_id,claim_id)"
      },
      {
        "type": "index",
        "name": "messages_receiver",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at)"
      },
      {
        "type": "index",
        "name": "operations_approval_requests",
        "tbl_name": "operations",
        "sql": "CREATE INDEX operations_approval_requests ON operations (\n  group_id, json_extract(data_json, '$.result.approval.bootId'), operation_id) WHERE json_extract(data_json, '$.command') = 'approval_request'"
      },
      {
        "type": "index",
        "name": "operations_presentation_agent",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "operations_presentation_ordinal",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "root_turns_boot",
        "tbl_name": "root_turns",
        "sql": "CREATE INDEX root_turns_boot ON root_turns(boot_id)"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_1",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_2",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_boot_owners_1",
        "tbl_name": "boot_owners",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_contents_1",
        "tbl_name": "contents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_1",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_2",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_groups_1",
        "tbl_name": "groups",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_managed_resources_1",
        "tbl_name": "managed_resources",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_messages_1",
        "tbl_name": "messages",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_operations_1",
        "tbl_name": "operations",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_1",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_2",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_thread_bindings_1",
        "tbl_name": "thread_bindings",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_workspace_execution_authorizations_1",
        "tbl_name": "workspace_execution_authorizations",
        "sql": null
      },
      {
        "type": "table",
        "name": "agents",
        "tbl_name": "agents",
        "sql": "CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "boot_owners",
        "tbl_name": "boot_owners",
        "sql": "CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')))"
      },
      {
        "type": "table",
        "name": "contents",
        "tbl_name": "contents",
        "sql": "CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "events",
        "tbl_name": "events",
        "sql": "CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "groups",
        "tbl_name": "groups",
        "sql": "CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "managed_resources",
        "tbl_name": "managed_resources",
        "sql": "CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "messages",
        "tbl_name": "messages",
        "sql": "CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "operations",
        "tbl_name": "operations",
        "sql": "CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id))"
      },
      {
        "type": "table",
        "name": "root_turns",
        "tbl_name": "root_turns",
        "sql": "CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "thread_bindings",
        "tbl_name": "thread_bindings",
        "sql": "CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0, delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted')), delete_json TEXT, pending_approval_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0))"
      },
      {
        "type": "table",
        "name": "workspace_execution_authorizations",
        "tbl_name": "workspace_execution_authorizations",
        "sql": "CREATE TABLE workspace_execution_authorizations (\n  profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL,\n  permission_revision INTEGER NOT NULL CHECK (typeof(permission_revision) = 'integer' AND permission_revision BETWEEN 0 AND 9007199254740991),\n  execution_allowed INTEGER NOT NULL CHECK (execution_allowed IN (0, 1)), updated_at INTEGER NOT NULL, actor_id TEXT,\n  last_receipt_json TEXT CHECK (last_receipt_json IS NULL OR json_valid(last_receipt_json)), PRIMARY KEY (profile_id, workspace_id))"
      }
    ]
  },
  {
    "version": 4,
    "schema": [
      {
        "type": "index",
        "name": "agents_page",
        "tbl_name": "agents",
        "sql": "CREATE INDEX agents_page ON agents(group_id,created_at,agent_id)"
      },
      {
        "type": "index",
        "name": "agents_presentation_ordinal",
        "tbl_name": "agents",
        "sql": "CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "groups_page",
        "tbl_name": "groups",
        "sql": "CREATE INDEX groups_page ON groups(thread_id,created_at,group_id)"
      },
      {
        "type": "index",
        "name": "messages_claim",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_claim ON messages(group_id,claim_id)"
      },
      {
        "type": "index",
        "name": "messages_receiver",
        "tbl_name": "messages",
        "sql": "CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at)"
      },
      {
        "type": "index",
        "name": "operations_approval_requests",
        "tbl_name": "operations",
        "sql": "CREATE INDEX operations_approval_requests ON operations (\n  group_id, json_extract(data_json, '$.result.approval.bootId'), operation_id) WHERE json_extract(data_json, '$.command') = 'approval_request'"
      },
      {
        "type": "index",
        "name": "operations_presentation_agent",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "operations_presentation_ordinal",
        "tbl_name": "operations",
        "sql": "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL"
      },
      {
        "type": "index",
        "name": "root_turns_boot",
        "tbl_name": "root_turns",
        "sql": "CREATE INDEX root_turns_boot ON root_turns(boot_id)"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_activity_members_1",
        "tbl_name": "activity_members",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_activity_runs_1",
        "tbl_name": "activity_runs",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_1",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_agents_2",
        "tbl_name": "agents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_boot_owners_1",
        "tbl_name": "boot_owners",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_contents_1",
        "tbl_name": "contents",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_1",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_events_2",
        "tbl_name": "events",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_groups_1",
        "tbl_name": "groups",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_managed_resources_1",
        "tbl_name": "managed_resources",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_messages_1",
        "tbl_name": "messages",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_operations_1",
        "tbl_name": "operations",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_1",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_root_turns_2",
        "tbl_name": "root_turns",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_thread_bindings_1",
        "tbl_name": "thread_bindings",
        "sql": null
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_workspace_execution_authorizations_1",
        "tbl_name": "workspace_execution_authorizations",
        "sql": null
      },
      {
        "type": "table",
        "name": "activity_members",
        "tbl_name": "activity_members",
        "sql": "CREATE TABLE activity_members(run_id TEXT NOT NULL REFERENCES activity_runs(run_id),member_id TEXT NOT NULL,group_id TEXT NOT NULL REFERENCES groups(group_id),data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(run_id,member_id))"
      },
      {
        "type": "table",
        "name": "activity_runs",
        "tbl_name": "activity_runs",
        "sql": "CREATE TABLE activity_runs(run_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "agents",
        "tbl_name": "agents",
        "sql": "CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "boot_owners",
        "tbl_name": "boot_owners",
        "sql": "CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')))"
      },
      {
        "type": "table",
        "name": "contents",
        "tbl_name": "contents",
        "sql": "CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "events",
        "tbl_name": "events",
        "sql": "CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "groups",
        "tbl_name": "groups",
        "sql": "CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "managed_resources",
        "tbl_name": "managed_resources",
        "sql": "CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "messages",
        "tbl_name": "messages",
        "sql": "CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id))"
      },
      {
        "type": "table",
        "name": "operations",
        "tbl_name": "operations",
        "sql": "CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id))"
      },
      {
        "type": "table",
        "name": "root_turns",
        "tbl_name": "root_turns",
        "sql": "CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
      },
      {
        "type": "table",
        "name": "thread_bindings",
        "tbl_name": "thread_bindings",
        "sql": "CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0, delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted')), delete_json TEXT, pending_approval_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0))"
      },
      {
        "type": "table",
        "name": "workspace_execution_authorizations",
        "tbl_name": "workspace_execution_authorizations",
        "sql": "CREATE TABLE workspace_execution_authorizations (\n  profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL,\n  permission_revision INTEGER NOT NULL CHECK (typeof(permission_revision) = 'integer' AND permission_revision BETWEEN 0 AND 9007199254740991),\n  execution_allowed INTEGER NOT NULL CHECK (execution_allowed IN (0, 1)), updated_at INTEGER NOT NULL, actor_id TEXT,\n  last_receipt_json TEXT CHECK (last_receipt_json IS NULL OR json_valid(last_receipt_json)), PRIMARY KEY (profile_id, workspace_id))"
      }
    ]
  }
]);
const schema5=freezeCapturedData([
  {
    "type": "index",
    "name": "agents_page",
    "tbl_name": "agents",
    "sql": "CREATE INDEX agents_page ON agents(group_id,created_at,agent_id)"
  },
  {
    "type": "index",
    "name": "agents_presentation_ordinal",
    "tbl_name": "agents",
    "sql": "CREATE UNIQUE INDEX agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL"
  },
  {
    "type": "index",
    "name": "groups_page",
    "tbl_name": "groups",
    "sql": "CREATE INDEX groups_page ON groups(thread_id,created_at,group_id)"
  },
  {
    "type": "index",
    "name": "messages_claim",
    "tbl_name": "messages",
    "sql": "CREATE INDEX messages_claim ON messages(group_id,claim_id)"
  },
  {
    "type": "index",
    "name": "messages_receiver",
    "tbl_name": "messages",
    "sql": "CREATE INDEX messages_receiver ON messages(group_id,receiver_id,created_at)"
  },
  {
    "type": "index",
    "name": "operations_approval_requests",
    "tbl_name": "operations",
    "sql": "CREATE INDEX operations_approval_requests ON operations (\n  group_id, json_extract(data_json, '$.result.approval.bootId'), operation_id) WHERE json_extract(data_json, '$.command') = 'approval_request'"
  },
  {
    "type": "index",
    "name": "operations_presentation_agent",
    "tbl_name": "operations",
    "sql": "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL"
  },
  {
    "type": "index",
    "name": "operations_presentation_ordinal",
    "tbl_name": "operations",
    "sql": "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL"
  },
  {
    "type": "index",
    "name": "root_turns_boot",
    "tbl_name": "root_turns",
    "sql": "CREATE INDEX root_turns_boot ON root_turns(boot_id)"
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_activity_members_1",
    "tbl_name": "activity_members",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_activity_runs_1",
    "tbl_name": "activity_runs",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_agents_1",
    "tbl_name": "agents",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_agents_2",
    "tbl_name": "agents",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_boot_owners_1",
    "tbl_name": "boot_owners",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_contents_1",
    "tbl_name": "contents",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_dsh_a_inbox_1",
    "tbl_name": "dsh_a_inbox",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_dsh_a_inbox_2",
    "tbl_name": "dsh_a_inbox",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_dsh_a_input_proofs_1",
    "tbl_name": "dsh_a_input_proofs",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_dsh_a_object_heads_1",
    "tbl_name": "dsh_a_object_heads",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_dsh_a_source_bindings_1",
    "tbl_name": "dsh_a_source_bindings",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_dsh_a_source_bindings_2",
    "tbl_name": "dsh_a_source_bindings",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_events_1",
    "tbl_name": "events",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_events_2",
    "tbl_name": "events",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_groups_1",
    "tbl_name": "groups",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_managed_resources_1",
    "tbl_name": "managed_resources",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_messages_1",
    "tbl_name": "messages",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_operations_1",
    "tbl_name": "operations",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_root_turns_1",
    "tbl_name": "root_turns",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_root_turns_2",
    "tbl_name": "root_turns",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_thread_bindings_1",
    "tbl_name": "thread_bindings",
    "sql": null
  },
  {
    "type": "index",
    "name": "sqlite_autoindex_workspace_execution_authorizations_1",
    "tbl_name": "workspace_execution_authorizations",
    "sql": null
  },
  {
    "type": "table",
    "name": "activity_members",
    "tbl_name": "activity_members",
    "sql": "CREATE TABLE activity_members(run_id TEXT NOT NULL REFERENCES activity_runs(run_id),member_id TEXT NOT NULL,group_id TEXT NOT NULL REFERENCES groups(group_id),data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(run_id,member_id))"
  },
  {
    "type": "table",
    "name": "activity_runs",
    "tbl_name": "activity_runs",
    "sql": "CREATE TABLE activity_runs(run_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
  },
  {
    "type": "table",
    "name": "agents",
    "tbl_name": "agents",
    "sql": "CREATE TABLE agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id))"
  },
  {
    "type": "table",
    "name": "boot_owners",
    "tbl_name": "boot_owners",
    "sql": "CREATE TABLE boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')))"
  },
  {
    "type": "table",
    "name": "contents",
    "tbl_name": "contents",
    "sql": "CREATE TABLE contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
  },
  {
    "type": "table",
    "name": "dsh_a_inbox",
    "tbl_name": "dsh_a_inbox",
    "sql": "CREATE TABLE dsh_a_inbox(input_id TEXT PRIMARY KEY,input_key TEXT NOT NULL UNIQUE,binding_id TEXT NOT NULL REFERENCES dsh_a_source_bindings(binding_id),object_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
  },
  {
    "type": "table",
    "name": "dsh_a_input_proofs",
    "tbl_name": "dsh_a_input_proofs",
    "sql": "CREATE TABLE dsh_a_input_proofs(input_id TEXT NOT NULL REFERENCES dsh_a_inbox(input_id),proof_version INTEGER NOT NULL,proof_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(input_id,proof_version))"
  },
  {
    "type": "table",
    "name": "dsh_a_object_heads",
    "tbl_name": "dsh_a_object_heads",
    "sql": "CREATE TABLE dsh_a_object_heads(object_id TEXT PRIMARY KEY,binding_id TEXT NOT NULL REFERENCES dsh_a_source_bindings(binding_id),revision INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
  },
  {
    "type": "table",
    "name": "dsh_a_profile",
    "tbl_name": "dsh_a_profile",
    "sql": "CREATE TABLE dsh_a_profile(singleton INTEGER PRIMARY KEY CHECK(singleton=1),profile TEXT NOT NULL,digest TEXT NOT NULL,store_id TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "dsh_a_source_bindings",
    "tbl_name": "dsh_a_source_bindings",
    "sql": "CREATE TABLE dsh_a_source_bindings(binding_id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
  },
  {
    "type": "table",
    "name": "events",
    "tbl_name": "events",
    "sql": "CREATE TABLE events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
  },
  {
    "type": "table",
    "name": "groups",
    "tbl_name": "groups",
    "sql": "CREATE TABLE groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
  },
  {
    "type": "table",
    "name": "managed_resources",
    "tbl_name": "managed_resources",
    "sql": "CREATE TABLE managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id))"
  },
  {
    "type": "table",
    "name": "messages",
    "tbl_name": "messages",
    "sql": "CREATE TABLE messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id))"
  },
  {
    "type": "table",
    "name": "operations",
    "tbl_name": "operations",
    "sql": "CREATE TABLE operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id))"
  },
  {
    "type": "table",
    "name": "root_turns",
    "tbl_name": "root_turns",
    "sql": "CREATE TABLE root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL)"
  },
  {
    "type": "table",
    "name": "thread_bindings",
    "tbl_name": "thread_bindings",
    "sql": "CREATE TABLE thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0, delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted')), delete_json TEXT, pending_approval_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0))"
  },
  {
    "type": "table",
    "name": "workspace_execution_authorizations",
    "tbl_name": "workspace_execution_authorizations",
    "sql": "CREATE TABLE workspace_execution_authorizations (\n  profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL,\n  permission_revision INTEGER NOT NULL CHECK (typeof(permission_revision) = 'integer' AND permission_revision BETWEEN 0 AND 9007199254740991),\n  execution_allowed INTEGER NOT NULL CHECK (execution_allowed IN (0, 1)), updated_at INTEGER NOT NULL, actor_id TEXT,\n  last_receipt_json TEXT CHECK (last_receipt_json IS NULL OR json_valid(last_receipt_json)), PRIMARY KEY (profile_id, workspace_id))"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_activity_members_delete",
    "tbl_name": "activity_members",
    "sql": "CREATE TRIGGER dsh_a_guard_activity_members_delete BEFORE DELETE ON activity_members BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_activity_members_insert",
    "tbl_name": "activity_members",
    "sql": "CREATE TRIGGER dsh_a_guard_activity_members_insert BEFORE INSERT ON activity_members BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_activity_members_update",
    "tbl_name": "activity_members",
    "sql": "CREATE TRIGGER dsh_a_guard_activity_members_update BEFORE UPDATE ON activity_members BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_activity_runs_delete",
    "tbl_name": "activity_runs",
    "sql": "CREATE TRIGGER dsh_a_guard_activity_runs_delete BEFORE DELETE ON activity_runs BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_activity_runs_insert",
    "tbl_name": "activity_runs",
    "sql": "CREATE TRIGGER dsh_a_guard_activity_runs_insert BEFORE INSERT ON activity_runs BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_activity_runs_update",
    "tbl_name": "activity_runs",
    "sql": "CREATE TRIGGER dsh_a_guard_activity_runs_update BEFORE UPDATE ON activity_runs BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_agents_delete",
    "tbl_name": "agents",
    "sql": "CREATE TRIGGER dsh_a_guard_agents_delete BEFORE DELETE ON agents BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_agents_insert",
    "tbl_name": "agents",
    "sql": "CREATE TRIGGER dsh_a_guard_agents_insert BEFORE INSERT ON agents BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_agents_update",
    "tbl_name": "agents",
    "sql": "CREATE TRIGGER dsh_a_guard_agents_update BEFORE UPDATE ON agents BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_boot_owners_delete",
    "tbl_name": "boot_owners",
    "sql": "CREATE TRIGGER dsh_a_guard_boot_owners_delete BEFORE DELETE ON boot_owners BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_boot_owners_insert",
    "tbl_name": "boot_owners",
    "sql": "CREATE TRIGGER dsh_a_guard_boot_owners_insert BEFORE INSERT ON boot_owners BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_boot_owners_update",
    "tbl_name": "boot_owners",
    "sql": "CREATE TRIGGER dsh_a_guard_boot_owners_update BEFORE UPDATE ON boot_owners BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_contents_delete",
    "tbl_name": "contents",
    "sql": "CREATE TRIGGER dsh_a_guard_contents_delete BEFORE DELETE ON contents BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_contents_insert",
    "tbl_name": "contents",
    "sql": "CREATE TRIGGER dsh_a_guard_contents_insert BEFORE INSERT ON contents BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_contents_update",
    "tbl_name": "contents",
    "sql": "CREATE TRIGGER dsh_a_guard_contents_update BEFORE UPDATE ON contents BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_inbox_delete",
    "tbl_name": "dsh_a_inbox",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_inbox_delete BEFORE DELETE ON dsh_a_inbox BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_inbox_insert",
    "tbl_name": "dsh_a_inbox",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_inbox_insert BEFORE INSERT ON dsh_a_inbox BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_inbox_update",
    "tbl_name": "dsh_a_inbox",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_inbox_update BEFORE UPDATE ON dsh_a_inbox BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_input_proofs_delete",
    "tbl_name": "dsh_a_input_proofs",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_input_proofs_delete BEFORE DELETE ON dsh_a_input_proofs BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_input_proofs_insert",
    "tbl_name": "dsh_a_input_proofs",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_input_proofs_insert BEFORE INSERT ON dsh_a_input_proofs BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_input_proofs_update",
    "tbl_name": "dsh_a_input_proofs",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_input_proofs_update BEFORE UPDATE ON dsh_a_input_proofs BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_object_heads_delete",
    "tbl_name": "dsh_a_object_heads",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_object_heads_delete BEFORE DELETE ON dsh_a_object_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_object_heads_insert",
    "tbl_name": "dsh_a_object_heads",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_object_heads_insert BEFORE INSERT ON dsh_a_object_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_object_heads_update",
    "tbl_name": "dsh_a_object_heads",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_object_heads_update BEFORE UPDATE ON dsh_a_object_heads BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_profile_delete",
    "tbl_name": "dsh_a_profile",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_profile_delete BEFORE DELETE ON dsh_a_profile BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END;SELECT RAISE(ABORT,'dsh_a_profile_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_profile_insert",
    "tbl_name": "dsh_a_profile",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_profile_insert BEFORE INSERT ON dsh_a_profile BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END;SELECT RAISE(ABORT,'dsh_a_profile_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_profile_update",
    "tbl_name": "dsh_a_profile",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_profile_update BEFORE UPDATE ON dsh_a_profile BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END;SELECT RAISE(ABORT,'dsh_a_profile_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_source_bindings_delete",
    "tbl_name": "dsh_a_source_bindings",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_source_bindings_delete BEFORE DELETE ON dsh_a_source_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_source_bindings_insert",
    "tbl_name": "dsh_a_source_bindings",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_source_bindings_insert BEFORE INSERT ON dsh_a_source_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_dsh_a_source_bindings_update",
    "tbl_name": "dsh_a_source_bindings",
    "sql": "CREATE TRIGGER dsh_a_guard_dsh_a_source_bindings_update BEFORE UPDATE ON dsh_a_source_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_events_delete",
    "tbl_name": "events",
    "sql": "CREATE TRIGGER dsh_a_guard_events_delete BEFORE DELETE ON events BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_events_insert",
    "tbl_name": "events",
    "sql": "CREATE TRIGGER dsh_a_guard_events_insert BEFORE INSERT ON events BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_events_update",
    "tbl_name": "events",
    "sql": "CREATE TRIGGER dsh_a_guard_events_update BEFORE UPDATE ON events BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_groups_delete",
    "tbl_name": "groups",
    "sql": "CREATE TRIGGER dsh_a_guard_groups_delete BEFORE DELETE ON groups BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_groups_insert",
    "tbl_name": "groups",
    "sql": "CREATE TRIGGER dsh_a_guard_groups_insert BEFORE INSERT ON groups BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_groups_update",
    "tbl_name": "groups",
    "sql": "CREATE TRIGGER dsh_a_guard_groups_update BEFORE UPDATE ON groups BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_managed_resources_delete",
    "tbl_name": "managed_resources",
    "sql": "CREATE TRIGGER dsh_a_guard_managed_resources_delete BEFORE DELETE ON managed_resources BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_managed_resources_insert",
    "tbl_name": "managed_resources",
    "sql": "CREATE TRIGGER dsh_a_guard_managed_resources_insert BEFORE INSERT ON managed_resources BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_managed_resources_update",
    "tbl_name": "managed_resources",
    "sql": "CREATE TRIGGER dsh_a_guard_managed_resources_update BEFORE UPDATE ON managed_resources BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_messages_delete",
    "tbl_name": "messages",
    "sql": "CREATE TRIGGER dsh_a_guard_messages_delete BEFORE DELETE ON messages BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_messages_insert",
    "tbl_name": "messages",
    "sql": "CREATE TRIGGER dsh_a_guard_messages_insert BEFORE INSERT ON messages BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_messages_update",
    "tbl_name": "messages",
    "sql": "CREATE TRIGGER dsh_a_guard_messages_update BEFORE UPDATE ON messages BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_operations_delete",
    "tbl_name": "operations",
    "sql": "CREATE TRIGGER dsh_a_guard_operations_delete BEFORE DELETE ON operations BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_operations_insert",
    "tbl_name": "operations",
    "sql": "CREATE TRIGGER dsh_a_guard_operations_insert BEFORE INSERT ON operations BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_operations_update",
    "tbl_name": "operations",
    "sql": "CREATE TRIGGER dsh_a_guard_operations_update BEFORE UPDATE ON operations BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_root_turns_delete",
    "tbl_name": "root_turns",
    "sql": "CREATE TRIGGER dsh_a_guard_root_turns_delete BEFORE DELETE ON root_turns BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_root_turns_insert",
    "tbl_name": "root_turns",
    "sql": "CREATE TRIGGER dsh_a_guard_root_turns_insert BEFORE INSERT ON root_turns BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_root_turns_update",
    "tbl_name": "root_turns",
    "sql": "CREATE TRIGGER dsh_a_guard_root_turns_update BEFORE UPDATE ON root_turns BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_thread_bindings_delete",
    "tbl_name": "thread_bindings",
    "sql": "CREATE TRIGGER dsh_a_guard_thread_bindings_delete BEFORE DELETE ON thread_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_thread_bindings_insert",
    "tbl_name": "thread_bindings",
    "sql": "CREATE TRIGGER dsh_a_guard_thread_bindings_insert BEFORE INSERT ON thread_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_thread_bindings_update",
    "tbl_name": "thread_bindings",
    "sql": "CREATE TRIGGER dsh_a_guard_thread_bindings_update BEFORE UPDATE ON thread_bindings BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_workspace_execution_authorizations_delete",
    "tbl_name": "workspace_execution_authorizations",
    "sql": "CREATE TRIGGER dsh_a_guard_workspace_execution_authorizations_delete BEFORE DELETE ON workspace_execution_authorizations BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_workspace_execution_authorizations_insert",
    "tbl_name": "workspace_execution_authorizations",
    "sql": "CREATE TRIGGER dsh_a_guard_workspace_execution_authorizations_insert BEFORE INSERT ON workspace_execution_authorizations BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  },
  {
    "type": "trigger",
    "name": "dsh_a_guard_workspace_execution_authorizations_update",
    "tbl_name": "workspace_execution_authorizations",
    "sql": "CREATE TRIGGER dsh_a_guard_workspace_execution_authorizations_update BEFORE UPDATE ON workspace_execution_authorizations BEGIN SELECT CASE WHEN xiaok_main_dsh_source_ingress_v1() IS NOT 'a8b73b2593641b365b4d1f6fd7768a800a031d385317d80b510a6272773a6615' THEN RAISE(ABORT,'dsh_a_writer_required') END; END"
  }
]);
export function readCapturedGroupsSchema(actual:ReturnType<typeof readProfileSqliteReaderSchema>,version:number):Readonly<{version:1|2|3|4|5|6;tables:readonly string[];threadQuery:'groups:thread_bindings'|'groups:thread_bindings-v1-0'|'groups:thread_bindings-v1-1'|'groups:thread_bindings-v1-2'}>{
 let expected:readonly Readonly<{type:string;name:string;tbl_name:string;sql:string|null}>[]|undefined,columns=0;
 if(version===6)expected=dshAuthoritySchema(schema5);else if(version===5)expected=schema5;else for(let i=0;i<variants.length;i++){const row=variants[i]!;if(row.version===(version===3?2:version)){if(row.schema.length!==actual.length)continue;let matches=true;for(let j=0;j<row.schema.length;j++){const want=row.schema[j]!,got=actual[j];if(!got||got.type!==want.type||got.name!==want.name||got.tbl_name!==want.tbl_name||got.sql!==want.sql){matches=false;break;}}if(matches){expected=row.schema;if('columns'in row)columns=row.columns??0;break;}}}
 if(!expected||version!==1&&version!==2&&version!==3&&version!==4&&version!==5&&version!==6||expected.length!==actual.length)throw Error('captured_groups_schema');
 const tables:string[]=[];for(let i=0;i<expected.length;i++){const want=expected[i]!,got=actual[i];if(!got||got.type!==want.type||got.name!==want.name||got.tbl_name!==want.tbl_name||got.sql!==want.sql)throw Error('captured_groups_schema');if(want.type==='table')schemaDefine(tables,tables.length,{value:want.name,enumerable:true,writable:true,configurable:true});}
 return schemaFreeze({version,tables:schemaFreeze(tables),threadQuery:version!==1?'groups:thread_bindings':`groups:thread_bindings-v1-${columns}` as 'groups:thread_bindings-v1-0'|'groups:thread_bindings-v1-1'|'groups:thread_bindings-v1-2'});
}
