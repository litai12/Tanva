import { getMetadataStorage } from 'class-validator';

/**
 * The @nestjs/swagger compiler plugin cannot express TypeScript string-literal unions
 * (`aspectRatio?: '1:1' | '16:9'`) and documents them as a bare `{ type: 'object' }`,
 * which misleads API clients and agents. The class-validator decorators on the same
 * properties are the runtime source of truth, so derive the real type / enum from them.
 *
 * Only bare object placeholders are rewritten; explicit schemas, nested DTO refs and
 * real objects (`@IsObject`, no type validator) are left untouched.
 */
type Schema = { type?: string; enum?: unknown[]; items?: Schema; properties?: Record<string, Schema>; additionalProperties?: unknown; $ref?: string; [key: string]: unknown };
interface ValidationMeta { propertyName: string; name?: string; constraints?: unknown[]; each?: boolean }

const isBareObject = (schema: Schema | undefined) => !!schema && schema.type === 'object' && !schema.properties && schema.additionalProperties === undefined && !schema.$ref && !schema.enum;

function enumValues(entity: unknown): unknown[] | null {
  if (!entity || typeof entity !== 'object') return null;
  const values = Object.entries(entity as Record<string, unknown>)
    // TS numeric enums carry reverse mappings (`1: 'A'`); keep only the forward values.
    .filter(([key, value]) => !(typeof value === 'string' && /^\d+$/.test(key) && (entity as Record<string, unknown>)[value] === Number(key)))
    .map(([, value]) => value);
  return values.length ? [...new Set(values)] : null;
}

const typeOfValues = (values: unknown[]) => (values.every(v => typeof v === 'number') ? 'number' : values.every(v => typeof v === 'string') ? 'string' : undefined);

/** Derives an item schema from class-validator decorators, or null when they don't determine one. */
export function schemaFromValidators(metas: ValidationMeta[]): Schema | null {
  const byName = new Map(metas.map(meta => [meta.name, meta]));
  const values = byName.has('isEnum') ? enumValues(byName.get('isEnum')!.constraints?.[0])
    : byName.has('isIn') && Array.isArray(byName.get('isIn')!.constraints?.[0]) ? [...new Set(byName.get('isIn')!.constraints![0] as unknown[])] : null;
  if (values?.length) {
    const type = typeOfValues(values);
    return type ? { type, enum: values } : { enum: values };
  }
  if (byName.has('isString') || byName.has('isUrl') || byName.has('isUUID') || byName.has('isDateString') || byName.has('isISO8601')) return { type: 'string' };
  if (byName.has('isInt')) return { type: 'integer' };
  if (byName.has('isNumber') || byName.has('isPositive')) return { type: 'number' };
  if (byName.has('isBoolean')) return { type: 'boolean' };
  return null;
}

export function applyClassValidatorTypes(document: { components?: { schemas?: Record<string, unknown> } }): number {
  const schemas = document.components?.schemas as Record<string, Schema> | undefined;
  if (!schemas) return 0;
  const storage = getMetadataStorage() as unknown as { validationMetadatas: Map<Function, ValidationMeta[]> };
  const classesByName = new Map<string, Function>();
  for (const target of storage.validationMetadatas.keys()) if (typeof target === 'function' && target.name) classesByName.set(target.name, target);
  let fixed = 0;
  for (const [name, schema] of Object.entries(schemas)) {
    const target = classesByName.get(name);
    if (!target || !schema.properties) continue;
    const metas = (getMetadataStorage().getTargetValidationMetadatas(target, '', true, false) as unknown as ValidationMeta[]);
    for (const [property, propertySchema] of Object.entries(schema.properties)) {
      const own = metas.filter(meta => meta.propertyName === property);
      if (!own.length) continue;
      if (isBareObject(propertySchema)) {
        const derived = schemaFromValidators(own.filter(meta => !meta.each));
        if (derived) { delete propertySchema.type; Object.assign(propertySchema, derived); fixed += 1; }
      } else if (propertySchema.type === 'array' && isBareObject(propertySchema.items)) {
        const derived = schemaFromValidators(own.filter(meta => meta.each));
        if (derived) { propertySchema.items = derived; fixed += 1; }
      }
    }
  }
  return fixed;
}
