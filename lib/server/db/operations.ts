import { DB_OPERATION_SQL, type DbOperation, isDbOperation } from "@/lib/db/operation-map";
import { withSurreal } from "@/lib/server/surreal";

type Vars = Record<string, unknown>;
type VarKind = "string" | "number" | "stringArray" | "optionalString" | "optionalNumber";
type VarRule = { kind: VarKind; values?: readonly string[] };
type VarSchema = Record<string, VarRule>;

const stringRule: VarRule = { kind: "string" };
const numberRule: VarRule = { kind: "number" };
const stringArrayRule: VarRule = { kind: "stringArray" };
const optionalStringRule: VarRule = { kind: "optionalString" };
const optionalNumberRule: VarRule = { kind: "optionalNumber" };

const MUTATION_OPERATIONS = new Set<DbOperation>([
  "datasetCreateFile",
  "datasetSoftDelete",
  "fileSoftDeleteById",
  "fileSoftDeleteByDatasetKey",
  "mergeGroupDeleteAll",
  "mergeGroupCreateAll",
  "labelCreate",
  "labelDelete",
  "annotationCreateBox",
  "annotationCreateText",
  "annotationUpdateText",
  "annotationDeleteById",
  "annotationDeleteByDatasetLabel",
  "inferenceJobCreate",
  "inferenceJobUpdate",
  "inferenceJobSoftDelete",
  "inferenceJobStop",
  "inferenceJobCopy",
  "trainingJobCreate",
  "trainingJobUpdate",
  "trainingJobDelete",
  "trainingJobStop",
]);

const OPERATION_SCHEMAS: Partial<Record<DbOperation, VarSchema>> = {
  datasetCheckExists: { dataset: stringRule },
  datasetCreateFile: {
    name: stringRule,
    key: stringRule,
    bucket: stringRule,
    size: numberRule,
    mime: stringRule,
    dataset: stringRule,
    encode: optionalStringRule,
    thumbKey: optionalStringRule,
    now: optionalStringRule,
  },
  datasetFilesByName: { dataset: stringRule },
  datasetSoftDelete: { dataset: stringRule },
  datasetNavFiles: { dataset: stringRule },
  fileById: { id: stringRule },
  fileSoftDeleteById: { id: stringRule },
  fileSoftDeleteByDatasetKey: { dataset: stringRule, key: stringRule },

  mergeGroupDeleteAll: { dataset: stringRule },
  mergeGroupCreateAll: { dataset: stringRule, members: stringArrayRule },
  mergeGroupGetAll: { dataset: stringRule },
  hlsJobsByDataset: { dataset: stringRule },
  hlsPlaylistByFile: { id: stringRule },

  labelNamesByDataset: { dataset: stringRule },
  labelsByDataset: { dataset: stringRule },
  labelCreate: { dataset: stringRule, name: stringRule },
  labelDelete: { dataset: stringRule, name: stringRule },

  annotationPresenceByDataset: { dataset: stringRule },
  annotationsImageByFile: { fid: stringRule },
  annotationsVideoByFile: { fid: stringRule },
  annotationTextByFile: { fid: stringRule },
  annotationCreateBox: {
    dataset: stringRule,
    file: stringRule,
    label: optionalStringRule,
    category: { kind: "string", values: ["image_bbox", "sam2_key_bbox"] },
    x1: numberRule,
    y1: numberRule,
    x2: numberRule,
    y2: numberRule,
  },
  annotationCreateText: { dataset: stringRule, file: stringRule, text: stringRule },
  annotationUpdateText: { id: stringRule, text: stringRule },
  annotationDeleteById: { id: stringRule },
  annotationDeleteByDatasetLabel: { dataset: stringRule, name: stringRule },

  inferenceJobByName: { name: stringRule },
  inferenceJobProgressByName: { name: stringRule },
  inferenceJobCheckByName: { name: stringRule },
  inferenceJobCreate: {
    name: stringRule,
    status: optionalStringRule,
    taskType: stringRule,
    model: stringRule,
    modelSource: { kind: "string", values: ["internet", "trained"] },
    datasets: stringArrayRule,
  },
  inferenceJobUpdate: {
    name: stringRule,
    status: optionalStringRule,
    taskType: stringRule,
    model: stringRule,
    modelSource: { kind: "string", values: ["internet", "trained"] },
    datasets: stringArrayRule,
  },
  inferenceJobSoftDelete: { name: stringRule },
  inferenceJobStop: { name: stringRule },
  inferenceJobCopy: {
    name: stringRule,
    taskType: stringRule,
    model: stringRule,
    modelSource: optionalStringRule,
    datasets: stringArrayRule,
  },
  inferenceResultsByJob: { job: stringRule },

  trainingJobByName: { name: stringRule },
  trainingJobCheckByName: { name: stringRule },
  trainingJobCreate: {
    name: stringRule,
    status: optionalStringRule,
    taskType: stringRule,
    model: stringRule,
    datasets: stringArrayRule,
    labels: stringArrayRule,
    epochs: optionalNumberRule,
    batchSize: optionalNumberRule,
    splitTrain: numberRule,
    splitTest: numberRule,
  },
  trainingJobUpdate: {
    name: stringRule,
    status: optionalStringRule,
    taskType: stringRule,
    model: stringRule,
    datasets: stringArrayRule,
    labels: stringArrayRule,
    epochs: optionalNumberRule,
    batchSize: optionalNumberRule,
    splitTrain: numberRule,
    splitTest: numberRule,
  },
  trainingJobDelete: { name: stringRule },
  trainingJobStop: { name: stringRule },
};

export class DbOperationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export async function executeDbOperation(operation: string, vars: Vars) {
  if (!isDbOperation(operation)) {
    throw new DbOperationError("DB operation is not allowed", 403);
  }
  if (!isVarsObject(vars)) {
    throw new DbOperationError("Invalid vars", 400);
  }

  const validatedVars = validateVars(operation, vars);
  auditDbOperation(operation, validatedVars);

  return withSurreal(async (client) => client.query(DB_OPERATION_SQL[operation], validatedVars));
}

function isVarsObject(value: unknown): value is Vars {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMutationOperation(operation: string): boolean {
  return isDbOperation(operation) && MUTATION_OPERATIONS.has(operation);
}

function validateVars(operation: DbOperation, vars: Vars): Vars {
  const schema = OPERATION_SCHEMAS[operation] ?? {};
  const allowed = new Set(Object.keys(schema));
  const validated: Vars = {};

  for (const key of Object.keys(vars)) {
    if (!allowed.has(key) && vars[key] !== undefined && vars[key] !== null) {
      throw new DbOperationError(`Unexpected variable: ${key}`, 400);
    }
  }

  for (const [key, rule] of Object.entries(schema)) {
    const value = vars[key];
    if (isOptional(rule) && (value === undefined || value === null)) {
      continue;
    }
    validated[key] = validateValue(key, value, rule);
  }

  return validated;
}

function isOptional(rule: VarRule): boolean {
  return rule.kind === "optionalString" || rule.kind === "optionalNumber";
}

function validateValue(key: string, value: unknown, rule: VarRule): unknown {
  const kind = rule.kind.replace("optional", "").toLowerCase();
  if (kind === "string") {
    if (typeof value !== "string" || value.length === 0) {
      throw new DbOperationError(`Invalid variable: ${key}`, 400);
    }
    if (rule.values && !rule.values.includes(value)) {
      throw new DbOperationError(`Invalid variable value: ${key}`, 400);
    }
    return value;
  }

  if (kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new DbOperationError(`Invalid variable: ${key}`, 400);
    }
    return value;
  }

  if (kind === "stringarray") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new DbOperationError(`Invalid variable: ${key}`, 400);
    }
    return value;
  }

  throw new DbOperationError(`Unsupported variable rule: ${key}`, 500);
}

function auditDbOperation(operation: DbOperation, vars: Vars): void {
  console.info("[db-operation]", JSON.stringify({
    operation,
    mutation: isMutationOperation(operation),
    varKeys: Object.keys(vars).sort(),
  }));
}
