/**
 * Minimal JSON Schema (draft 2020-12 subset) validator for Clara skills.
 *
 * Supports exactly the keywords skill.schema.json uses. Any other keyword
 * throws instead of being silently ignored, so the schema can never quietly
 * stop enforcing a constraint. Pure functions only; no dependencies.
 */

export type JsonSchema = { [keyword: string]: unknown } | boolean;

export interface SchemaError {
  /** JSON Pointer into the instance, e.g. /steps/3/actions/0. */
  path: string;
  message: string;
}

const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description"]);
const SUPPORTED = new Set([
  "$ref",
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "pattern",
  "minimum",
  "oneOf",
  "allOf",
  "if",
  "then",
]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  return actual === expected || (expected === "number" && actual === "integer");
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref: ${ref}`);
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  return node as JsonSchema;
}

function check(
  root: JsonSchema,
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: SchemaError[]
): void {
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path, message: "value not allowed" });
    return;
  }
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword) && !ANNOTATIONS.has(keyword)) {
      throw new Error(`Unsupported JSON Schema keyword "${keyword}" at ${path || "/"}`);
    }
  }
  const s = schema as Record<string, unknown>;

  if (typeof s.$ref === "string") {
    check(root, resolveRef(root, s.$ref), value, path, errors);
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push({ path, message: `expected ${types.join(" | ")}, got ${typeOf(value)}` });
      return;
    }
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => deepEqual(e, value))) {
    errors.push({ path, message: `must be one of ${JSON.stringify(s.enum)}` });
  }
  if ("const" in s && !deepEqual(s.const, value)) {
    errors.push({ path, message: `must equal ${JSON.stringify(s.const)}` });
  }

  if (typeof value === "string") {
    if (typeof s.minLength === "number" && value.length < s.minLength) {
      errors.push({ path, message: `shorter than ${s.minLength}` });
    }
    if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(value)) {
      errors.push({ path, message: `does not match ${s.pattern}` });
    }
  }
  if (typeof value === "number" && typeof s.minimum === "number" && value < s.minimum) {
    errors.push({ path, message: `less than ${s.minimum}` });
  }

  if (Array.isArray(value)) {
    if (typeof s.minItems === "number" && value.length < s.minItems) {
      errors.push({ path, message: `needs at least ${s.minItems} item(s)` });
    }
    if (typeof s.maxItems === "number" && value.length > s.maxItems) {
      errors.push({ path, message: `allows at most ${s.maxItems} item(s)` });
    }
    if (s.items !== undefined) {
      value.forEach((item, i) =>
        check(root, s.items as JsonSchema, item, `${path}/${i}`, errors)
      );
    }
  }

  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of (s.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push({ path, message: `missing required "${key}"` });
    }
    const props = (s.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [key, child] of Object.entries(obj)) {
      if (key in props) {
        check(root, props[key], child, `${path}/${key}`, errors);
      } else if (s.additionalProperties !== undefined) {
        check(root, s.additionalProperties as JsonSchema, child, `${path}/${key}`, errors);
      }
    }
  }

  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf as JsonSchema[]) check(root, sub, value, path, errors);
  }
  if (Array.isArray(s.oneOf)) {
    const branchErrors = (s.oneOf as JsonSchema[]).map((sub) => {
      const errs: SchemaError[] = [];
      check(root, sub, value, path, errs);
      return errs;
    });
    const passing = branchErrors.filter((e) => e.length === 0).length;
    if (passing !== 1) {
      const closest = branchErrors.reduce((a, b) => (b.length < a.length ? b : a));
      errors.push({
        path,
        message:
          passing === 0
            ? `matches no oneOf branch (closest: ${closest.map((e) => `${e.path} ${e.message}`).join("; ")})`
            : `matches ${passing} oneOf branches; exactly 1 required`,
      });
    }
  }
  if (s.if !== undefined) {
    const ifErrors: SchemaError[] = [];
    check(root, s.if as JsonSchema, value, path, ifErrors);
    if (ifErrors.length === 0 && s.then !== undefined) {
      check(root, s.then as JsonSchema, value, path, errors);
    }
  }
}

/** Validate `value` against `schema`. Returns [] when valid. */
export function validateJsonSchema(schema: JsonSchema, value: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  check(schema, schema, value, "", errors);
  return errors;
}
