export declare const ARTIFACT_WORKSPACE_SOURCE_SCHEMA: readonly Readonly<{
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_lineages_1";
    readonly tbl_name: "artifact_lineages";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_lineages_2";
    readonly tbl_name: "artifact_lineages";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_artifact_claims_1";
    readonly tbl_name: "artifact_workspace_artifact_claims";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_audit_log_1";
    readonly tbl_name: "artifact_workspace_audit_log";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_events_1";
    readonly tbl_name: "artifact_workspace_events";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_nodes_1";
    readonly tbl_name: "artifact_workspace_nodes";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_projection_receipts_1";
    readonly tbl_name: "artifact_workspace_projection_receipts";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_relations_1";
    readonly tbl_name: "artifact_workspace_relations";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_staging_files_1";
    readonly tbl_name: "artifact_workspace_staging_files";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_task_cursors_1";
    readonly tbl_name: "artifact_workspace_task_cursors";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_versions_1";
    readonly tbl_name: "artifact_workspace_versions";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_view_sessions_1";
    readonly tbl_name: "artifact_workspace_view_sessions";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspace_views_1";
    readonly tbl_name: "artifact_workspace_views";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspaces_1";
    readonly tbl_name: "artifact_workspaces";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_artifact_workspaces_2";
    readonly tbl_name: "artifact_workspaces";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_workspace_generation_leases_1";
    readonly tbl_name: "workspace_generation_leases";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_workspace_generation_leases_2";
    readonly tbl_name: "workspace_generation_leases";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "sqlite_autoindex_workspace_generation_requests_1";
    readonly tbl_name: "workspace_generation_requests";
    readonly sql: null;
} | {
    readonly type: "index";
    readonly name: "uq_artifact_workspace_active_view_session";
    readonly tbl_name: "artifact_workspace_view_sessions";
    readonly sql: "CREATE UNIQUE INDEX uq_artifact_workspace_active_view_session on artifact_workspace_view_sessions(workspace_id, view_key) where closed_at is null";
} | {
    readonly type: "index";
    readonly name: "uq_workspace_active_generation";
    readonly tbl_name: "workspace_generation_requests";
    readonly sql: "CREATE UNIQUE INDEX uq_workspace_active_generation on workspace_generation_requests(placeholder_node_id) where state in ('prepared', 'running', 'needs_recovery')";
} | {
    readonly type: "index";
    readonly name: "uq_workspace_event_dedupe";
    readonly tbl_name: "artifact_workspace_events";
    readonly sql: "CREATE UNIQUE INDEX uq_workspace_event_dedupe on artifact_workspace_events(workspace_id, event_name, dedupe_key) where dedupe_key is not null";
} | {
    readonly type: "table";
    readonly name: "artifact_lineages";
    readonly tbl_name: "artifact_lineages";
    readonly sql: "CREATE TABLE artifact_lineages ( id text primary key, workspace_id text not null references artifact_workspaces(id), source_locator_hash text not null, preferred_version_id text, created_at text not null, updated_at text not null, unique(workspace_id, source_locator_hash) )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_artifact_claims";
    readonly tbl_name: "artifact_workspace_artifact_claims";
    readonly sql: "CREATE TABLE artifact_workspace_artifact_claims ( generation_request_id text not null, produced_artifact_id text not null, outcome_kind text not null check(outcome_kind in ('ready_version', 'staging')), outcome_id text not null, created_at text not null, primary key(generation_request_id, produced_artifact_id) )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_audit_log";
    readonly tbl_name: "artifact_workspace_audit_log";
    readonly sql: "CREATE TABLE artifact_workspace_audit_log ( id text primary key, actor_id text, actor_kind text not null check(actor_kind in ('user', 'agent', 'scheduler', 'system_reconcile')), request_source text check(request_source in ('user', 'agent', 'scheduler')), workspace_id text references artifact_workspaces(id), node_id text, version_id text, expected_revision integer, actual_revision integer, producing_task_id text, producing_agent_id text, plugin_source text, action text not null, result text not null check(result in ('success', 'denied', 'failed', 'quarantined')), error_code text, created_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_events";
    readonly tbl_name: "artifact_workspace_events";
    readonly sql: "CREATE TABLE artifact_workspace_events ( id text primary key, workspace_id text not null references artifact_workspaces(id), conversation_id text not null, request_id text, event_name text not null, dedupe_key text, metadata_json text not null, created_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_meta";
    readonly tbl_name: "artifact_workspace_meta";
    readonly sql: "CREATE TABLE artifact_workspace_meta ( schema_version integer primary key check(schema_version = 1) )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_nodes";
    readonly tbl_name: "artifact_workspace_nodes";
    readonly sql: "CREATE TABLE artifact_workspace_nodes ( id text primary key, workspace_id text not null references artifact_workspaces(id), kind text not null check(kind in ('artifact', 'placeholder', 'collection', 'note')), lineage_id text, artifact_version_id text, placeholder_kind text, title text, note_text text, owner text not null check(owner in ('user', 'agent')), created_by_task_id text, x real not null, y real not null, width real not null, height real not null, z_index integer not null, layout_revision integer not null default 0, tombstoned_at text, created_at text not null, updated_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_projection_receipts";
    readonly tbl_name: "artifact_workspace_projection_receipts";
    readonly sql: "CREATE TABLE artifact_workspace_projection_receipts ( generation_request_id text not null, produced_artifact_id text not null, projection_kind text not null check(projection_kind in ('narrow_tool', 'task_event', 'startup_reconcile')), created_at text not null, primary key(generation_request_id, produced_artifact_id, projection_kind) )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_relations";
    readonly tbl_name: "artifact_workspace_relations";
    readonly sql: "CREATE TABLE artifact_workspace_relations ( id text primary key, workspace_id text not null references artifact_workspaces(id), from_node_id text not null references artifact_workspace_nodes(id), to_node_id text not null references artifact_workspace_nodes(id), kind text not null check(kind in ('derived_from', 'references', 'part_of_collection')), order_index integer, created_by text not null check(created_by in ('user', 'agent', 'system')), created_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_staging_files";
    readonly tbl_name: "artifact_workspace_staging_files";
    readonly sql: "CREATE TABLE artifact_workspace_staging_files ( id text primary key, source text not null check(source in ('materialize', 'generation')), generation_request_id text, producing_task_id text, produced_artifact_id text, source_locator_hash text, availability text not null check(availability in ('present', 'unavailable')), file_ref text, owner text not null check(owner = 'system_staging'), quarantine_reason text, keep integer not null default 0 check(keep in (0, 1)), created_at text not null, expires_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_task_cursors";
    readonly tbl_name: "artifact_workspace_task_cursors";
    readonly sql: "CREATE TABLE artifact_workspace_task_cursors ( task_id text primary key, event_index integer not null, updated_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_versions";
    readonly tbl_name: "artifact_workspace_versions";
    readonly sql: "CREATE TABLE artifact_workspace_versions ( id text primary key, lineage_id text not null references artifact_lineages(id), parent_version_id text references artifact_workspace_versions(id), file_ref text not null, storage_kind text not null check(storage_kind in ('single_file', 'sealed_package')), entry_ref text, package_manifest_ref text, source_kind text not null check(source_kind in ('materialized_base', 'workspace_generation')), source_task_id text, source_artifact_id text, source_evidence_id text, external_task_ref text, kind text not null, mime_type text, byte_size integer, checksum text not null, producing_task_id text, producing_agent_id text, runtime_source text, plugin_source text, status text not null check(status in ('ready', 'missing')), created_at text not null )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_view_sessions";
    readonly tbl_name: "artifact_workspace_view_sessions";
    readonly sql: "CREATE TABLE artifact_workspace_view_sessions ( id text primary key, workspace_id text not null references artifact_workspaces(id), view_key text not null, opened_at text not null, last_seen_at text not null, closed_at text )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspace_views";
    readonly tbl_name: "artifact_workspace_views";
    readonly sql: "CREATE TABLE artifact_workspace_views ( workspace_id text not null references artifact_workspaces(id), view_key text not null, viewport_x real not null, viewport_y real not null, viewport_zoom real not null, view_revision integer not null, updated_at text not null, primary key(workspace_id, view_key) )";
} | {
    readonly type: "table";
    readonly name: "artifact_workspaces";
    readonly tbl_name: "artifact_workspaces";
    readonly sql: "CREATE TABLE artifact_workspaces ( id text primary key, conversation_id text not null unique, workspace_root_id text not null, schema_version integer not null check(schema_version = 1), structure_revision integer not null default 0, created_at text not null, updated_at text not null )";
} | {
    readonly type: "table";
    readonly name: "workspace_generation_leases";
    readonly tbl_name: "workspace_generation_leases";
    readonly sql: "CREATE TABLE workspace_generation_leases ( id text primary key, generation_request_id text not null unique references workspace_generation_requests(id), workspace_id text not null references artifact_workspaces(id), node_id text not null references artifact_workspace_nodes(id), source_version_id text references artifact_workspace_versions(id), allowed_action text not null check(allowed_action in ('fulfill_placeholder', 'append_revision', 'append_collection_item')), requested_kind text not null check(requested_kind in ('image', 'html', 'markdown', 'slides')), producing_task_id text not null, producing_agent_id text, expires_at text not null, consumed_at text, cancelled_at text, created_at text not null )";
} | {
    readonly type: "table";
    readonly name: "workspace_generation_requests";
    readonly tbl_name: "workspace_generation_requests";
    readonly sql: "CREATE TABLE workspace_generation_requests ( id text primary key, workspace_id text not null references artifact_workspaces(id), placeholder_node_id text not null references artifact_workspace_nodes(id), source_version_id text references artifact_workspace_versions(id), producing_task_id text, external_task_ref text, state text not null check(state in ('prepared', 'running', 'ready', 'failed', 'cancelled', 'needs_recovery', 'superseded')), error_code text, supersedes_request_id text references workspace_generation_requests(id), created_at text not null, updated_at text not null )";
}>[];
declare const queries: {
    readonly artifact_lineages: {
        readonly table: "artifact_lineages";
        readonly columns: readonly ["id", "workspace_id", "source_locator_hash", "preferred_version_id", "created_at", "updated_at"];
    };
    readonly artifact_workspace_artifact_claims: {
        readonly table: "artifact_workspace_artifact_claims";
        readonly columns: readonly ["generation_request_id", "produced_artifact_id", "outcome_kind", "outcome_id", "created_at"];
    };
    readonly artifact_workspace_audit_log: {
        readonly table: "artifact_workspace_audit_log";
        readonly columns: readonly ["id", "actor_id", "actor_kind", "request_source", "workspace_id", "node_id", "version_id", "expected_revision", "actual_revision", "producing_task_id", "producing_agent_id", "plugin_source", "action", "result", "error_code", "created_at"];
    };
    readonly artifact_workspace_events: {
        readonly table: "artifact_workspace_events";
        readonly columns: readonly ["id", "workspace_id", "conversation_id", "request_id", "event_name", "dedupe_key", "metadata_json", "created_at"];
    };
    readonly artifact_workspace_meta: {
        readonly table: "artifact_workspace_meta";
        readonly columns: readonly ["schema_version"];
    };
    readonly artifact_workspace_nodes: {
        readonly table: "artifact_workspace_nodes";
        readonly columns: readonly ["id", "workspace_id", "kind", "lineage_id", "artifact_version_id", "placeholder_kind", "title", "note_text", "owner", "created_by_task_id", "x", "y", "width", "height", "z_index", "layout_revision", "tombstoned_at", "created_at", "updated_at"];
    };
    readonly artifact_workspace_projection_receipts: {
        readonly table: "artifact_workspace_projection_receipts";
        readonly columns: readonly ["generation_request_id", "produced_artifact_id", "projection_kind", "created_at"];
    };
    readonly artifact_workspace_relations: {
        readonly table: "artifact_workspace_relations";
        readonly columns: readonly ["id", "workspace_id", "from_node_id", "to_node_id", "kind", "order_index", "created_by", "created_at"];
    };
    readonly artifact_workspace_staging_files: {
        readonly table: "artifact_workspace_staging_files";
        readonly columns: readonly ["id", "source", "generation_request_id", "producing_task_id", "produced_artifact_id", "source_locator_hash", "availability", "file_ref", "owner", "quarantine_reason", "keep", "created_at", "expires_at"];
    };
    readonly artifact_workspace_task_cursors: {
        readonly table: "artifact_workspace_task_cursors";
        readonly columns: readonly ["task_id", "event_index", "updated_at"];
    };
    readonly artifact_workspace_versions: {
        readonly table: "artifact_workspace_versions";
        readonly columns: readonly ["id", "lineage_id", "parent_version_id", "file_ref", "storage_kind", "entry_ref", "package_manifest_ref", "source_kind", "source_task_id", "source_artifact_id", "source_evidence_id", "external_task_ref", "kind", "mime_type", "byte_size", "checksum", "producing_task_id", "producing_agent_id", "runtime_source", "plugin_source", "status", "created_at"];
    };
    readonly artifact_workspace_view_sessions: {
        readonly table: "artifact_workspace_view_sessions";
        readonly columns: readonly ["id", "workspace_id", "view_key", "opened_at", "last_seen_at", "closed_at"];
    };
    readonly artifact_workspace_views: {
        readonly table: "artifact_workspace_views";
        readonly columns: readonly ["workspace_id", "view_key", "viewport_x", "viewport_y", "viewport_zoom", "view_revision", "updated_at"];
    };
    readonly artifact_workspaces: {
        readonly table: "artifact_workspaces";
        readonly columns: readonly ["id", "conversation_id", "workspace_root_id", "schema_version", "structure_revision", "created_at", "updated_at"];
    };
    readonly workspace_generation_leases: {
        readonly table: "workspace_generation_leases";
        readonly columns: readonly ["id", "generation_request_id", "workspace_id", "node_id", "source_version_id", "allowed_action", "requested_kind", "producing_task_id", "producing_agent_id", "expires_at", "consumed_at", "cancelled_at", "created_at"];
    };
    readonly workspace_generation_requests: {
        readonly table: "workspace_generation_requests";
        readonly columns: readonly ["id", "workspace_id", "placeholder_node_id", "source_version_id", "producing_task_id", "external_task_ref", "state", "error_code", "supersedes_request_id", "created_at", "updated_at"];
    };
};
export declare const ARTIFACT_WORKSPACE_QUERIES: Readonly<{
    readonly artifact_lineages: {
        readonly table: "artifact_lineages";
        readonly columns: readonly ["id", "workspace_id", "source_locator_hash", "preferred_version_id", "created_at", "updated_at"];
    };
    readonly artifact_workspace_artifact_claims: {
        readonly table: "artifact_workspace_artifact_claims";
        readonly columns: readonly ["generation_request_id", "produced_artifact_id", "outcome_kind", "outcome_id", "created_at"];
    };
    readonly artifact_workspace_audit_log: {
        readonly table: "artifact_workspace_audit_log";
        readonly columns: readonly ["id", "actor_id", "actor_kind", "request_source", "workspace_id", "node_id", "version_id", "expected_revision", "actual_revision", "producing_task_id", "producing_agent_id", "plugin_source", "action", "result", "error_code", "created_at"];
    };
    readonly artifact_workspace_events: {
        readonly table: "artifact_workspace_events";
        readonly columns: readonly ["id", "workspace_id", "conversation_id", "request_id", "event_name", "dedupe_key", "metadata_json", "created_at"];
    };
    readonly artifact_workspace_meta: {
        readonly table: "artifact_workspace_meta";
        readonly columns: readonly ["schema_version"];
    };
    readonly artifact_workspace_nodes: {
        readonly table: "artifact_workspace_nodes";
        readonly columns: readonly ["id", "workspace_id", "kind", "lineage_id", "artifact_version_id", "placeholder_kind", "title", "note_text", "owner", "created_by_task_id", "x", "y", "width", "height", "z_index", "layout_revision", "tombstoned_at", "created_at", "updated_at"];
    };
    readonly artifact_workspace_projection_receipts: {
        readonly table: "artifact_workspace_projection_receipts";
        readonly columns: readonly ["generation_request_id", "produced_artifact_id", "projection_kind", "created_at"];
    };
    readonly artifact_workspace_relations: {
        readonly table: "artifact_workspace_relations";
        readonly columns: readonly ["id", "workspace_id", "from_node_id", "to_node_id", "kind", "order_index", "created_by", "created_at"];
    };
    readonly artifact_workspace_staging_files: {
        readonly table: "artifact_workspace_staging_files";
        readonly columns: readonly ["id", "source", "generation_request_id", "producing_task_id", "produced_artifact_id", "source_locator_hash", "availability", "file_ref", "owner", "quarantine_reason", "keep", "created_at", "expires_at"];
    };
    readonly artifact_workspace_task_cursors: {
        readonly table: "artifact_workspace_task_cursors";
        readonly columns: readonly ["task_id", "event_index", "updated_at"];
    };
    readonly artifact_workspace_versions: {
        readonly table: "artifact_workspace_versions";
        readonly columns: readonly ["id", "lineage_id", "parent_version_id", "file_ref", "storage_kind", "entry_ref", "package_manifest_ref", "source_kind", "source_task_id", "source_artifact_id", "source_evidence_id", "external_task_ref", "kind", "mime_type", "byte_size", "checksum", "producing_task_id", "producing_agent_id", "runtime_source", "plugin_source", "status", "created_at"];
    };
    readonly artifact_workspace_view_sessions: {
        readonly table: "artifact_workspace_view_sessions";
        readonly columns: readonly ["id", "workspace_id", "view_key", "opened_at", "last_seen_at", "closed_at"];
    };
    readonly artifact_workspace_views: {
        readonly table: "artifact_workspace_views";
        readonly columns: readonly ["workspace_id", "view_key", "viewport_x", "viewport_y", "viewport_zoom", "view_revision", "updated_at"];
    };
    readonly artifact_workspaces: {
        readonly table: "artifact_workspaces";
        readonly columns: readonly ["id", "conversation_id", "workspace_root_id", "schema_version", "structure_revision", "created_at", "updated_at"];
    };
    readonly workspace_generation_leases: {
        readonly table: "workspace_generation_leases";
        readonly columns: readonly ["id", "generation_request_id", "workspace_id", "node_id", "source_version_id", "allowed_action", "requested_kind", "producing_task_id", "producing_agent_id", "expires_at", "consumed_at", "cancelled_at", "created_at"];
    };
    readonly workspace_generation_requests: {
        readonly table: "workspace_generation_requests";
        readonly columns: readonly ["id", "workspace_id", "placeholder_node_id", "source_version_id", "producing_task_id", "external_task_ref", "state", "error_code", "supersedes_request_id", "created_at", "updated_at"];
    };
}>;
export type ArtifactWorkspaceQueryId = keyof typeof queries;
export declare const ARTIFACT_WORKSPACE_TABLES: readonly ("artifact_lineages" | "artifact_workspace_artifact_claims" | "artifact_workspace_audit_log" | "artifact_workspace_events" | "artifact_workspace_nodes" | "artifact_workspace_projection_receipts" | "artifact_workspace_relations" | "artifact_workspace_staging_files" | "artifact_workspace_task_cursors" | "artifact_workspace_versions" | "artifact_workspace_view_sessions" | "artifact_workspace_views" | "artifact_workspaces" | "workspace_generation_leases" | "workspace_generation_requests" | "artifact_workspace_meta")[];
export {};
