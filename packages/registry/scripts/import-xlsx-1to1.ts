import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init, id, tx } from "@instantdb/admin";
import { PlatformApi } from "@instantdb/platform";
import { i } from "@instantdb/react";
import { domain } from "@ekairos/domain";
import {
  configureRuntime,
  resolveRuntime as resolveDomainRuntime,
} from "@ekairos/domain/runtime";

type ColumnKind = "string" | "number" | "date" | "boolean" | "any";

type ColumnSpec = {
  name: string;
  kind: ColumnKind;
  optional: boolean;
  observedTypes: string[];
};

type DatasetSpec = {
  entityName: string;
  sourcePath: string;
  sourceFileName: string;
  sheetName: string;
  rowCount: number;
  columns: ColumnSpec[];
};

type SessionFile = {
  createdAt: string;
  updatedAt: string;
  appId: string;
  adminToken: string;
  title: string;
  domainName: string;
  files: string[];
  datasets: DatasetSpec[];
  importedRowCounts: Record<string, number>;
  verifiedRowCounts: Record<string, number>;
};

type PythonCell =
  | null
  | string
  | number
  | boolean
  | {
      __cellType: "date" | "datetime";
      value: string;
    };

type PythonWorkbookPayload = {
  sheetName: string;
  headers: string[];
  rowCount: number;
  columns: Array<{
    name: string;
    observedTypes: string[];
  }>;
  rows: Array<Record<string, PythonCell>>;
};

type ImportRuntimeEnv = {
  instant: {
    appId: string;
    adminToken: string;
  };
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = resolve(SCRIPT_DIR, "..");
const WORKSPACE_DIR = resolve(REGISTRY_DIR, "..", "..");
const TMP_DIR = join(WORKSPACE_DIR, "tmp");
const SESSION_PATH = join(TMP_DIR, "xlsx-1to1-instant-session.json");
const DOMAIN_NAME = "xlsx_1to1_import";
const APP_TITLE_PREFIX = "ekairos-xlsx-1to1";
const BATCH_SIZE = 100;

const DEFAULT_FILES = [
  "C:/Users/aleja/Downloads/requerimientos_ejemplo_desde_01012026.xlsx",
  "C:/Users/aleja/Downloads/proveedores.xlsx",
  "C:/Users/aleja/Downloads/ocs_ejemplo_desde_01012026.xlsx",
  "C:/Users/aleja/Downloads/items.xlsx",
  "C:/Users/aleja/Downloads/cuentas_contables_gastos.xlsx",
];

const DEFAULT_PERMS = {
  $default: {
    allow: {
      $default: "true",
    },
  },
  $streams: {
    allow: {
      view: "true",
    },
  },
} as const;

let runtimeConfigured = false;

function main() {
  loadWorkspaceEnv();

  const [command = "import", arg1, arg2] = process.argv.slice(2);

  if (command === "import") {
    return runImport();
  }

  if (command === "status") {
    return runStatus();
  }

  if (command === "query") {
    if (!arg1) {
      throw new Error("query requires an entity name.");
    }
    const limit = arg2 ? Number(arg2) : 10;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error("query limit must be a positive number.");
    }
    return runQuery(arg1, limit);
  }

  if (command === "destroy") {
    return runDestroy();
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runImport() {
  ensureFilesExist(DEFAULT_FILES);

  const loadedDatasets = DEFAULT_FILES.map((sourcePath) => {
    const entityName = sanitizeEntityName(basename(sourcePath, extname(sourcePath)));
    const workbook = readWorkbookWithPython(sourcePath);
    const columns = workbook.columns.map((column) => ({
      name: column.name,
      observedTypes: column.observedTypes,
      kind: inferColumnKind(column.observedTypes),
      optional: column.observedTypes.includes("null"),
    }));

    return {
      spec: {
        entityName,
        sourcePath,
        sourceFileName: basename(sourcePath),
        sheetName: workbook.sheetName,
        rowCount: workbook.rowCount,
        columns,
      } satisfies DatasetSpec,
      rows: workbook.rows,
    };
  });

  const appDomain = buildDomain(loadedDatasets.map((entry) => entry.spec));
  const schema = appDomain.toInstantSchema();
  const platform = new PlatformApi({
    auth: {
      token: getInstantPersonalAccessToken(),
    },
  });

  const created = await platform.createApp({
    title: `${APP_TITLE_PREFIX}-${formatTimestampForTitle(new Date())}`,
    schema: schema as any,
    perms: DEFAULT_PERMS as any,
  });

  const appId = String(created?.app?.id ?? "").trim();
  const adminToken = String(created?.app?.adminToken ?? "").trim();
  const title = String(created?.app?.title ?? "").trim();

  if (!appId || !adminToken || !title) {
    throw new Error("Instant did not return appId/adminToken/title for the created app.");
  }

  const session: SessionFile = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appId,
    adminToken,
    title,
    domainName: DOMAIN_NAME,
    files: [...DEFAULT_FILES],
    datasets: loadedDatasets.map((entry) => entry.spec),
    importedRowCounts: {},
    verifiedRowCounts: {},
  };

  writeSession(session);

  const db = await resolveDbForSession(session);

  for (const dataset of loadedDatasets) {
    const inserted = await importDatasetRows({
      db,
      dataset: dataset.spec,
      rows: dataset.rows,
    });
    session.importedRowCounts[dataset.spec.entityName] = inserted;
    session.updatedAt = new Date().toISOString();
    writeSession(session);
  }

  for (const dataset of loadedDatasets) {
    const verified = await queryAllRows(db, dataset.spec.entityName);
    session.verifiedRowCounts[dataset.spec.entityName] = verified.length;
  }

  session.updatedAt = new Date().toISOString();
  writeSession(session);

  printJson({
    ok: true,
    sessionPath: SESSION_PATH,
    app: {
      appId: session.appId,
      title: session.title,
    },
    datasets: session.datasets.map((dataset) => ({
      entityName: dataset.entityName,
      sourceFileName: dataset.sourceFileName,
      rowCount: dataset.rowCount,
      imported: session.importedRowCounts[dataset.entityName] ?? 0,
      verified: session.verifiedRowCounts[dataset.entityName] ?? 0,
    })),
    nextCommands: [
      "pnpm tsx packages/registry/scripts/import-xlsx-1to1.ts status",
      `pnpm tsx packages/registry/scripts/import-xlsx-1to1.ts query ${session.datasets[0]?.entityName ?? "entity"} 5`,
      "pnpm tsx packages/registry/scripts/import-xlsx-1to1.ts destroy",
    ],
  });
}

async function runStatus() {
  const session = readSession();
  const db = await resolveDbForSession(session);
  const verifiedRowCounts: Record<string, number> = {};

  for (const dataset of session.datasets) {
    const rows = await queryAllRows(db, dataset.entityName);
    verifiedRowCounts[dataset.entityName] = rows.length;
  }

  session.verifiedRowCounts = verifiedRowCounts;
  session.updatedAt = new Date().toISOString();
  writeSession(session);

  printJson({
    ok: true,
    sessionPath: SESSION_PATH,
    app: {
      appId: session.appId,
      title: session.title,
    },
    datasets: session.datasets.map((dataset) => ({
      entityName: dataset.entityName,
      sourceFileName: dataset.sourceFileName,
      expected: dataset.rowCount,
      imported: session.importedRowCounts[dataset.entityName] ?? 0,
      verified: verifiedRowCounts[dataset.entityName] ?? 0,
    })),
  });
}

async function runQuery(entityName: string, limit: number) {
  const session = readSession();
  const normalizedEntity = sanitizeEntityName(entityName);
  const dataset = session.datasets.find((entry) => entry.entityName === normalizedEntity);

  if (!dataset) {
    throw new Error(`Entity not found in session: ${normalizedEntity}`);
  }

  const db = await resolveDbForSession(session);
  const result = await db.query({
    [normalizedEntity]: {
      $: {
        limit,
      },
    },
  } as any);

  printJson({
    ok: true,
    appId: session.appId,
    entityName: normalizedEntity,
    limit,
    rows: (result as Record<string, unknown[]>)[normalizedEntity] ?? [],
  });
}

async function runDestroy() {
  const session = readSession();
  const platform = new PlatformApi({
    auth: {
      token: getInstantPersonalAccessToken(),
    },
  });

  const deleted = await platform.deleteApp(session.appId);
  if (existsSync(SESSION_PATH)) {
    rmSync(SESSION_PATH, { force: true });
  }

  printJson({
    ok: true,
    appId: session.appId,
    deleted: true,
    title: String(deleted?.app?.title ?? session.title),
    sessionPathRemoved: SESSION_PATH,
  });
}

function buildDomain(datasets: DatasetSpec[]) {
  const entities: Record<string, ReturnType<typeof i.entity>> = {};

  for (const dataset of datasets) {
    const attributes: Record<string, any> = {};
    for (const column of dataset.columns) {
      let attribute: any;
      if (column.kind === "string") attribute = i.string();
      else if (column.kind === "number") attribute = i.number();
      else if (column.kind === "date") attribute = i.date();
      else if (column.kind === "boolean") attribute = i.boolean();
      else attribute = i.any();

      if (column.optional) {
        attribute = attribute.optional();
      }

      attributes[column.name] = attribute;
    }

    entities[dataset.entityName] = i.entity(attributes);
  }

  return domain(DOMAIN_NAME).schema({
    entities,
    links: {},
    rooms: {},
  });
}

async function resolveDbForSession(session: SessionFile) {
  const appDomain = buildDomain(session.datasets);
  ensureRuntimeConfigured(appDomain);
  const runtime = await resolveDomainRuntime(appDomain as any, {
    instant: {
      appId: session.appId,
      adminToken: session.adminToken,
    },
  } satisfies ImportRuntimeEnv);
  return runtime.db as any;
}

function ensureRuntimeConfigured(appDomain: ReturnType<typeof buildDomain>) {
  if (runtimeConfigured) {
    return;
  }

  configureRuntime({
    domain: {
      domain: appDomain,
    },
    runtime: async (env: ImportRuntimeEnv, resolvedDomain) => {
      const domainForDb = resolvedDomain ?? appDomain;
      const db = init({
        appId: env.instant.appId,
        adminToken: env.instant.adminToken,
        schema: (domainForDb as any).toInstantSchema(),
        useDateObjects: true,
      });
      return { db };
    },
  });

  runtimeConfigured = true;
}

async function importDatasetRows(params: {
  db: any;
  dataset: DatasetSpec;
  rows: Array<Record<string, PythonCell>>;
}) {
  const txEntity = (tx as any)[params.dataset.entityName];
  if (!txEntity) {
    throw new Error(`tx entity not found: ${params.dataset.entityName}`);
  }

  let inserted = 0;
  let batch: any[] = [];

  for (const row of params.rows) {
    const payload = decodeRow(row);
    batch.push(txEntity[id()].update(payload));

    if (batch.length >= BATCH_SIZE) {
      await params.db.transact(batch);
      inserted += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await params.db.transact(batch);
    inserted += batch.length;
  }

  return inserted;
}

function decodeRow(row: Record<string, PythonCell>) {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === null) {
      continue;
    }

    if (
      typeof value === "object" &&
      value !== null &&
      "__cellType" in value &&
      (value.__cellType === "date" || value.__cellType === "datetime")
    ) {
      payload[key] = new Date(value.value);
      continue;
    }

    payload[key] = value;
  }

  return payload;
}

async function queryAllRows(db: any, entityName: string) {
  const result = await db.query({
    [entityName]: {},
  } as any);

  return (result as Record<string, unknown[]>)[entityName] ?? [];
}

function readWorkbookWithPython(sourcePath: string): PythonWorkbookPayload {
  const pythonCode = `
import json
import sys
from datetime import date, datetime
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb.worksheets[0]
rows_iter = ws.iter_rows(values_only=True)
headers = [str(value) if value is not None else "" for value in next(rows_iter)]
observed = {header: set() for header in headers}
rows = []

def classify(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, datetime):
        return "datetime"
    if isinstance(value, date):
        return "date"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    return "str"

def encode(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, datetime):
        return {"__cellType": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__cellType": "date", "value": value.isoformat()}
    if isinstance(value, (int, float)):
        return value
    return str(value)

for raw_row in rows_iter:
    row = {}
    for header, value in zip(headers, raw_row):
        observed[header].add(classify(value))
        row[header] = encode(value)
    rows.append(row)

payload = {
    "sheetName": ws.title,
    "headers": headers,
    "rowCount": len(rows),
    "columns": [
        {
            "name": header,
            "observedTypes": sorted(observed[header]),
        }
        for header in headers
    ],
    "rows": rows,
}

print(json.dumps(payload, ensure_ascii=False))
`;

  const execution = spawnSync("python", ["-c", pythonCode, sourcePath], {
    cwd: WORKSPACE_DIR,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (execution.status !== 0) {
    throw new Error(
      [
        `Failed to read workbook with python: ${sourcePath}`,
        execution.stderr?.trim() || execution.stdout?.trim() || "unknown_python_error",
      ].join("\n"),
    );
  }

  return JSON.parse(execution.stdout) as PythonWorkbookPayload;
}

function inferColumnKind(observedTypes: string[]): ColumnKind {
  const concrete = observedTypes.filter((entry) => entry !== "null");
  const unique = new Set(concrete);

  if (unique.size === 0) return "any";
  if (unique.size === 1 && unique.has("str")) return "string";
  if (unique.size === 1 && unique.has("bool")) return "boolean";
  if (unique.size === 1 && (unique.has("date") || unique.has("datetime"))) return "date";

  const numeric = new Set(["int", "float"]);
  if ([...unique].every((entry) => numeric.has(entry))) {
    return "number";
  }

  return "any";
}

function sanitizeEntityName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!normalized) {
    throw new Error(`Cannot derive entity name from value: ${value}`);
  }

  if (/^[0-9]/.test(normalized)) {
    return `sheet_${normalized}`;
  }

  return normalized;
}

function ensureFilesExist(filePaths: string[]) {
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
  }
}

function loadWorkspaceEnv() {
  const envPath = join(WORKSPACE_DIR, ".env.local");
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquoteEnvValue(value);
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function getInstantPersonalAccessToken() {
  const token = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("Missing INSTANT_PERSONAL_ACCESS_TOKEN in workspace environment.");
  }
  return token;
}

function formatTimestampForTitle(value: Date) {
  const iso = value.toISOString();
  return iso.replace(/[:.]/g, "-");
}

function readSession() {
  if (!existsSync(SESSION_PATH)) {
    throw new Error(`Session file not found: ${SESSION_PATH}`);
  }

  return JSON.parse(readFileSync(SESSION_PATH, "utf8")) as SessionFile;
}

function writeSession(session: SessionFile) {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), "utf8");
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  printJson({
    ok: false,
    error: message,
  });
  process.exitCode = 1;
});
