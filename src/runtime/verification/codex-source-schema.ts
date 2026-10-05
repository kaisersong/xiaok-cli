import {freezeCapturedData} from './captured-source-json.js';
/** Full sqlite_master from the actual original CodexTaskBridge constructors.
 * Reference data only; unknown historical layouts remain unresolved. */
export const CODEX_SOURCE_SCHEMAS=freezeCapturedData({
  "codex-native-sqlite-v1": [
    {
      "type": "index",
      "name": "sqlite_autoindex_codex_native_sessions_1",
      "tbl_name": "codex_native_sessions",
      "sql": null
    },
    {
      "type": "table",
      "name": "codex_native_sessions",
      "tbl_name": "codex_native_sessions",
      "sql": "CREATE TABLE codex_native_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, native_id TEXT, snapshot TEXT NOT NULL)"
    }
  ],
  "codex-routes-sqlite-v1": [
    {
      "type": "index",
      "name": "sqlite_autoindex_routes_1",
      "tbl_name": "routes",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_settings_1",
      "tbl_name": "settings",
      "sql": null
    },
    {
      "type": "index",
      "name": "sqlite_autoindex_threads_1",
      "tbl_name": "threads",
      "sql": null
    },
    {
      "type": "table",
      "name": "routes",
      "tbl_name": "routes",
      "sql": "CREATE TABLE routes(task_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL)"
    },
    {
      "type": "table",
      "name": "settings",
      "tbl_name": "settings",
      "sql": "CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT)"
    },
    {
      "type": "table",
      "name": "threads",
      "tbl_name": "threads",
      "sql": "CREATE TABLE threads (id TEXT PRIMARY KEY,native_id TEXT)"
    }
  ]
} as const);
