/** Complete sqlite_master reference from the actual SqliteGoalStore constructor.
 * This is comparison data, never SQL to execute. Schema changes require a new
 * explicit format review rather than accepting a matching table-name subset. */
export const GOAL_SOURCE_SCHEMA = Object.freeze([
    {
        "type": "index",
        "name": "goal_events_goal",
        "tbl_name": "goal_events",
        "sql": "CREATE INDEX goal_events_goal on goal_events(goal_id, recorded_at)"
    },
    {
        "type": "index",
        "name": "goal_evidence_goal",
        "tbl_name": "goal_evidence",
        "sql": "CREATE INDEX goal_evidence_goal on goal_evidence(goal_id, epoch, recorded_at)"
    },
    {
        "type": "index",
        "name": "goal_publication_attempts_goal",
        "tbl_name": "goal_publication_attempts",
        "sql": "CREATE INDEX goal_publication_attempts_goal on goal_publication_attempts(goal_id)"
    },
    {
        "type": "index",
        "name": "goal_thread_context_tasks_thread",
        "tbl_name": "goal_thread_context_tasks",
        "sql": "CREATE INDEX goal_thread_context_tasks_thread on goal_thread_context_tasks(thread_id, ordinal)"
    },
    {
        "type": "index",
        "name": "goal_thread_tasks_thread",
        "tbl_name": "goal_thread_tasks",
        "sql": "CREATE INDEX goal_thread_tasks_thread on goal_thread_tasks(thread_id, ordinal)"
    },
    {
        "type": "index",
        "name": "goals_session_id",
        "tbl_name": "goals",
        "sql": "CREATE INDEX goals_session_id on goals(session_id, created_at)"
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_completion_intents_1",
        "tbl_name": "goal_completion_intents",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_completion_intents_2",
        "tbl_name": "goal_completion_intents",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_events_1",
        "tbl_name": "goal_events",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_evidence_1",
        "tbl_name": "goal_evidence",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_publication_attempts_1",
        "tbl_name": "goal_publication_attempts",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_publication_attempts_2",
        "tbl_name": "goal_publication_attempts",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_sessions_1",
        "tbl_name": "goal_sessions",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_thread_context_tasks_1",
        "tbl_name": "goal_thread_context_tasks",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_thread_context_tasks_2",
        "tbl_name": "goal_thread_context_tasks",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_thread_tasks_1",
        "tbl_name": "goal_thread_tasks",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_thread_tasks_2",
        "tbl_name": "goal_thread_tasks",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_thread_tasks_3",
        "tbl_name": "goal_thread_tasks",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goal_turns_1",
        "tbl_name": "goal_turns",
        "sql": null
    },
    {
        "type": "index",
        "name": "sqlite_autoindex_goals_1",
        "tbl_name": "goals",
        "sql": null
    },
    {
        "type": "table",
        "name": "goal_completion_intents",
        "tbl_name": "goal_completion_intents",
        "sql": "CREATE TABLE goal_completion_intents ( intent_id text primary key, goal_id text not null, epoch integer not null, turn_id text not null, revision integer not null, intent_json text not null, unique(goal_id, epoch, turn_id) )"
    },
    {
        "type": "table",
        "name": "goal_events",
        "tbl_name": "goal_events",
        "sql": "CREATE TABLE goal_events ( event_id text primary key, session_id text not null, goal_id text not null, revision integer not null, event_json text not null, recorded_at integer not null )"
    },
    {
        "type": "table",
        "name": "goal_evidence",
        "tbl_name": "goal_evidence",
        "sql": "CREATE TABLE goal_evidence ( evidence_id text primary key, goal_id text not null, epoch integer not null, goal_turn_id text not null, evidence_json text not null, recorded_at integer not null )"
    },
    {
        "type": "table",
        "name": "goal_publication_attempts",
        "tbl_name": "goal_publication_attempts",
        "sql": "CREATE TABLE goal_publication_attempts ( attempt_id text primary key, intent_id text not null, goal_id text not null, sequence integer not null, revision integer not null, attempt_json text not null, unique(intent_id, sequence) )"
    },
    {
        "type": "table",
        "name": "goal_sessions",
        "tbl_name": "goal_sessions",
        "sql": "CREATE TABLE goal_sessions ( session_id text primary key, current_goal_id text not null, updated_at integer not null )"
    },
    {
        "type": "table",
        "name": "goal_thread_context_tasks",
        "tbl_name": "goal_thread_context_tasks",
        "sql": "CREATE TABLE goal_thread_context_tasks ( context_id text primary key, goal_id text not null, thread_id text not null, task_id text not null unique, ordinal integer not null, recorded_at integer not null )"
    },
    {
        "type": "table",
        "name": "goal_thread_tasks",
        "tbl_name": "goal_thread_tasks",
        "sql": "CREATE TABLE goal_thread_tasks ( binding_id text primary key, goal_id text not null, epoch integer not null, goal_turn_id text not null, thread_id text not null, task_id text not null unique, origin text not null check(origin in ('user', 'continuation')), ordinal integer not null, attached_at integer, unique(goal_id, epoch, goal_turn_id) )"
    },
    {
        "type": "table",
        "name": "goal_turns",
        "tbl_name": "goal_turns",
        "sql": "CREATE TABLE goal_turns ( goal_id text not null, epoch integer not null, turn_id text not null, turn_json text not null, recorded_at integer not null, primary key(goal_id, epoch, turn_id) )"
    },
    {
        "type": "table",
        "name": "goals",
        "tbl_name": "goals",
        "sql": "CREATE TABLE goals ( goal_id text primary key, session_id text not null, revision integer not null, epoch integer not null, state_json text not null, created_at integer not null, updated_at integer not null )"
    }
].map(row => Object.freeze(row)));
