export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateToolInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  const required = schema.required as string[] | undefined;
  if (Array.isArray(required)) {
    for (const field of required) {
      if (input[field] === undefined || input[field] === null) {
        errors.push(`missing required field: ${field}`);
      }
    }
  }

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    for (const [key, value] of Object.entries(input)) {
      const propSchema = properties[key];
      if (!propSchema) continue; // allow unknown fields (model may pass extra params)

      const expectedType = propSchema.type as string | undefined;
      if (!expectedType) continue;

      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (expectedType === 'number' && actualType !== 'number') {
        errors.push(`field "${key}" expected number, got ${actualType}`);
      } else if (expectedType === 'string' && actualType !== 'string') {
        errors.push(`field "${key}" expected string, got ${actualType}`);
      } else if (expectedType === 'boolean' && actualType !== 'boolean') {
        errors.push(`field "${key}" expected boolean, got ${actualType}`);
      } else if (expectedType === 'array' && actualType !== 'array') {
        errors.push(`field "${key}" expected array, got ${actualType}`);
      } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
        errors.push(`field "${key}" expected object, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
