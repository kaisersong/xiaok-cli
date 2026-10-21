/** Exact schema facts captured through the original DesktopMultiAgentStore
 * constructor/base migration statements. Comparison data only, never executed. */
import { freezeCapturedData } from './captured-source-json.js';
const variants = freezeCapturedData([
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
    }
]);
export function readCapturedGroupsSchema(actual, version) {
    const match = variants.find(candidate => candidate.version === (version === 3 ? 2 : version) && candidate.schema.length === actual.length && candidate.schema.every((expected, index) => { const row = actual[index]; return row && row.type === expected.type && row.name === expected.name && row.tbl_name === expected.tbl_name && row.sql === expected.sql; }));
    if (!match || version !== 1 && version !== 2 && version !== 3)
        throw Error('captured_groups_schema');
    return Object.freeze({ version, tables: Object.freeze(match.schema.filter(row => row.type === 'table').map(row => row.name)), threadQuery: version !== 1 ? 'groups:thread_bindings' : `groups:thread_bindings-v1-${'columns' in match ? match.columns : 0}` });
}
