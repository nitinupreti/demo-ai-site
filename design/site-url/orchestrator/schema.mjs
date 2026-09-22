/**
 * Minimal JSON Schema validator covering the subset used by design/site-url/schemas.
 * Kept dependency-free so the launcher needs no install step.
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

export function validate(value, schema, pointer = '') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((entry) => matchesType(value, entry))) {
      errors.push(`${pointer || '/'}: expected ${expected.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pointer || '/'}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  }

  if (typeOf(value) === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${pointer}: shorter than ${schema.minLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pointer}: does not match ${schema.pattern}`);
    }
  }

  if (typeOf(value) === 'number' || typeOf(value) === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${pointer}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${pointer}: above maximum ${schema.maximum}`);
    }
  }

  if (typeOf(value) === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pointer}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((entry, index) => errors.push(...validate(entry, schema.items, `${pointer}/${index}`)));
    }
  }

  if (typeOf(value) === 'object') {
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${pointer}/${required}: is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validate(value[key], childSchema, `${pointer}/${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(schema.properties && key in schema.properties)) {
          errors.push(`${pointer}/${key}: is not an allowed property`);
        }
      }
    }
  }

  return errors;
}

export function assertValid(value, schema, label) {
  const errors = validate(value, schema);
  if (errors.length) {
    throw new Error(`${label} is invalid:\n  - ${errors.slice(0, 12).join('\n  - ')}`);
  }
  return value;
}
