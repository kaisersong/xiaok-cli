import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
// Validation is non-mutating: defaults/coercion/removal would authorize a
// different input. Unknown annotation keywords are compatible with MCP tools.
const options = { strict: false, strictNumbers: true, allErrors: true, validateFormats: false, ownProperties: true };
const draft7 = new Ajv(options);
const draft2020 = new Ajv2020(options);
const validators = new Map();
function message(error) {
    if (error.keyword === 'required')
        return `missing required field: ${error.params.missingProperty}`;
    if (error.keyword === 'type')
        return `field "${error.instancePath}" expected ${error.params.type}`;
    return `field "${error.instancePath}" ${error.message ?? 'invalid'}`;
}
export function validateToolInput(schema, input) {
    try {
        const key = JSON.stringify(schema);
        let validate = validators.get(key);
        if (!validate) {
            // Remove compiled schemas on eviction too, avoiding an unbounded SDK/MCP cache.
            if (validators.size >= 256) {
                validators.clear();
                draft7.removeSchema();
                draft2020.removeSchema();
            }
            const owner = String(schema.$schema ?? '').includes('2020-12') ? draft2020 : draft7;
            validate = owner.compile(schema);
            validators.set(key, validate);
        }
        const valid = validate(input);
        return { valid: valid === true, errors: valid ? [] : (validate.errors ?? []).map(message) };
    }
    catch {
        // An unsupported/malformed schema must not turn into permission to dispatch.
        return { valid: false, errors: ['invalid or unsupported tool schema'] };
    }
}
