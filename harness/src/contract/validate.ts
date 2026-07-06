import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";

export type ContractSchemaName = "manifest" | "events" | "waterfall";

export type ContractSchemas = Record<ContractSchemaName, unknown>;

export type ValidationResult = {
  valid: boolean;
  errors: ErrorObject[] | null | undefined;
};

const schemaFiles: Record<ContractSchemaName, string> = {
  manifest: "manifest.schema.json",
  events: "events.schema.json",
  waterfall: "waterfall.schema.json"
};

export async function loadContractSchemas(
  contractDir = path.join(process.cwd(), "contract")
): Promise<ContractSchemas> {
  const entries = await Promise.all(
    Object.entries(schemaFiles).map(async ([name, fileName]) => {
      const raw = await readFile(path.join(contractDir, fileName), "utf8");
      return [name, JSON.parse(raw)] as const;
    })
  );

  return Object.fromEntries(entries) as ContractSchemas;
}

export function validateManifest(value: unknown): ValidationResult {
  return runValidator("manifest", value);
}

export function validateEvent(value: unknown): ValidationResult {
  return runValidator("events", value);
}

export function validateWaterfallRow(value: unknown): ValidationResult {
  return runValidator("waterfall", value);
}

function runValidator(name: ContractSchemaName, value: unknown): ValidationResult {
  const validate = getValidator(name);
  const valid = validate(value);

  return {
    valid,
    errors: validate.errors
  };
}

const validatorCache = new Map<ContractSchemaName, ValidateFunction>();

function getValidator(name: ContractSchemaName): ValidateFunction {
  const cached = validatorCache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemaPath = path.join(process.cwd(), "contract", schemaFiles[name]);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as AnySchema;
  const validate = ajv.compile(schema);
  validatorCache.set(name, validate);
  return validate;
}
