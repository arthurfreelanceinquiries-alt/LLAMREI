import { createRequire } from 'node:module';
import { Ajv, type ValidateFunction } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';

const addFormats = createRequire(import.meta.url)('ajv-formats') as FormatsPlugin;
const validators = new WeakMap<Record<string, unknown>, ValidateFunction>();

export function validateToolInput(schema: Record<string, unknown>, args: unknown): boolean {
  if (schema.type !== 'object' || schema.$async === true || !args || typeof args !== 'object' || Array.isArray(args)) return false;
  try {
    // Disallow undeclared top-level fields, including account and routing overrides.
    let validate = validators.get(schema);
    if (!validate) {
      validate = addFormats(new Ajv()).compile({ ...schema, additionalProperties: false });
      validators.set(schema, validate);
    }
    return validate(args) === true;
  } catch {
    return false;
  }
}
