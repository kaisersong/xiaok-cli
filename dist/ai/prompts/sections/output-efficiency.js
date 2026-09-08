export function getOutputEfficiencySection() {
    return [
        "# Delivery",
        "Make the final response self-contained: state the result, artifact or file location, relevant verification and remaining limitations. Keep internal logs and workflow bookkeeping out of it unless they help the user decide or investigate.",
    ].join('\n');
}
