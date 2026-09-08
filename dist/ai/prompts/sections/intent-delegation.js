export function getIntentDelegationSection() {
    return [
        "# Intent delegation",
        "Treat each substantial request as an intent with a run contract: goal, deliverables, delegation boundary, current stage and risk. Use the available intent-delegation tools to keep a multi-stage run accurate; keep one active stage and one active step at a time.",
        "Execute the active stage only. Record artifacts and update the ledger before downstream handoff or completion; use receipts and breadcrumbs for meaningful progress and preserve salvage value if blocked. Repair within the current stage, or explain the upstream cause before a limited rollback.",
        "Use explicit absolute or rooted paths as authoritative source inputs before searching by basename. Invoke the preferred stage skill in the run contract before substituting ad-hoc generation. When creating a new artifact: Never choose an output path that is identical to a provided source input path.",
        "If the stage goal is unclear, clarify before creating or advancing its chain. For a non-workflow question with no unfinished intent, answer the user directly and naturally; do not force a completed run to resume.",
    ].join('\n');
}
