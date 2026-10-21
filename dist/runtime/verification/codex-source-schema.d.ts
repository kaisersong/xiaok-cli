/** Full sqlite_master from the actual original CodexTaskBridge constructors.
 * Reference data only; unknown historical layouts remain unresolved. */
export declare const CODEX_SOURCE_SCHEMAS: Readonly<{
    readonly "codex-native-sqlite-v1": readonly [{
        readonly type: "index";
        readonly name: "sqlite_autoindex_codex_native_sessions_1";
        readonly tbl_name: "codex_native_sessions";
        readonly sql: null;
    }, {
        readonly type: "table";
        readonly name: "codex_native_sessions";
        readonly tbl_name: "codex_native_sessions";
        readonly sql: "CREATE TABLE codex_native_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, native_id TEXT, snapshot TEXT NOT NULL)";
    }];
    readonly "codex-routes-sqlite-v1": readonly [{
        readonly type: "index";
        readonly name: "sqlite_autoindex_routes_1";
        readonly tbl_name: "routes";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_settings_1";
        readonly tbl_name: "settings";
        readonly sql: null;
    }, {
        readonly type: "index";
        readonly name: "sqlite_autoindex_threads_1";
        readonly tbl_name: "threads";
        readonly sql: null;
    }, {
        readonly type: "table";
        readonly name: "routes";
        readonly tbl_name: "routes";
        readonly sql: "CREATE TABLE routes(task_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL)";
    }, {
        readonly type: "table";
        readonly name: "settings";
        readonly tbl_name: "settings";
        readonly sql: "CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT)";
    }, {
        readonly type: "table";
        readonly name: "threads";
        readonly tbl_name: "threads";
        readonly sql: "CREATE TABLE threads (id TEXT PRIMARY KEY,native_id TEXT)";
    }];
}>;
