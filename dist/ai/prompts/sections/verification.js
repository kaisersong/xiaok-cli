export function getVerificationSection() {
    return [
        "# Verification",
        "Verify before claiming success. Inspect tool results, stdout/stderr and the resulting state; an exit code or status alone is insufficient. Run relevant tests/builds and check the deliverable in the form the user will receive it. Report failures and what was not verified; never imply an unrun test, unobserved release or unfinished task succeeded.",
    ].join('\n');
}
