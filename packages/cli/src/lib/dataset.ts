import meow from "meow";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { init, id as newId } from "@instantdb/admin";
import { DatasetService, datasetDomain } from "@ekairos/dataset";

type DatasetRows = Array<Record<string, any>>;

type DatasetCreateFlags = {
  appId?: string;
  adminToken?: string;
  datasetId?: string;
  title?: string;
  status?: string;
  rows?: string;
  rowsFile?: string;
  schema?: string;
  schemaFile?: string;
  pretty?: boolean;
};

function readEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function resolveInstantCredentials(flags: DatasetCreateFlags) {
  const appId =
    flags.appId ||
    readEnv("INSTANT_APP_ID") ||
    readEnv("NEXT_PUBLIC_INSTANT_APP_ID");
  const adminToken = flags.adminToken || readEnv("INSTANT_APP_ADMIN_TOKEN");
  return { appId, adminToken };
}

function parseJsonValue(value: string, label: string) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be valid JSON: ${msg}`);
  }
}

async function readJsonFile(filePath: string, label: string) {
  const absPath = resolve(process.cwd(), filePath);
  const content = await readFile(absPath, "utf-8");
  return parseJsonValue(content, label);
}

function parseJsonl(content: string): DatasetRows {
  const rows: DatasetRows = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(parseJsonValue(trimmed, "rowsFile JSONL"));
  }
  return rows;
}

function normalizeRows(data: any): DatasetRows {
  if (Array.isArray(data)) return data as DatasetRows;
  if (data && typeof data === "object" && Array.isArray(data.rows)) {
    return data.rows as DatasetRows;
  }
  throw new Error("rows must be a JSON array or an object with a rows[] field.");
}

async function loadRows(flags: DatasetCreateFlags): Promise<DatasetRows> {
  if (flags.rows && flags.rowsFile) {
    throw new Error("Provide either --rows or --rows-file, not both.");
  }

  if (flags.rows) {
    const parsed = parseJsonValue(flags.rows, "rows");
    return normalizeRows(parsed);
  }

  if (flags.rowsFile) {
    const absPath = resolve(process.cwd(), flags.rowsFile);
    const content = await readFile(absPath, "utf-8");
    if (absPath.endsWith(".jsonl") || absPath.endsWith(".ndjson")) {
      return parseJsonl(content);
    }
    const parsed = parseJsonValue(content, "rowsFile");
    return normalizeRows(parsed);
  }

  throw new Error("Missing dataset rows. Provide --rows or --rows-file.");
}

async function loadSchema(flags: DatasetCreateFlags, rows: DatasetRows) {
  if (flags.schema && flags.schemaFile) {
    throw new Error("Provide either --schema or --schema-file, not both.");
  }

  if (flags.schema) {
    return parseJsonValue(flags.schema, "schema");
  }

  if (flags.schemaFile) {
    return await readJsonFile(flags.schemaFile, "schemaFile");
  }

  return inferSchema(rows);
}

function inferSchema(rows: DatasetRows) {
  const first = rows[0] ?? {};
  const schema: Record<string, string> = {};
  for (const [key, value] of Object.entries(first)) {
    if (typeof value === "number") {
      schema[key] = "number";
    } else if (typeof value === "boolean") {
      schema[key] = "boolean";
    } else if (value === null || value === undefined) {
      schema[key] = "null";
    } else {
      schema[key] = "string";
    }
  }
  return { schema };
}

function toJson(data: any, pretty?: boolean) {
  return JSON.stringify(data, null, pretty ? 2 : 0);
}

async function runDatasetCreate(rawArgs: string[]) {
  const datasetCli = meow(
    `
Usage
  $ ekairos dataset create --rows-file rows.json --app-id <id> --admin-token <token>

Options
  --app-id        InstantDB app id (or INSTANT_APP_ID / NEXT_PUBLIC_INSTANT_APP_ID)
  --admin-token   InstantDB admin token (or INSTANT_APP_ADMIN_TOKEN)
  --dataset-id    Optional dataset id (default: generated)
  --title         Optional dataset title
  --status        Dataset status (default: completed)
  --rows          JSON array of rows (string)
  --rows-file     Path to JSON or JSONL file
  --schema        JSON schema object (string)
  --schema-file   Path to JSON schema file
  --pretty        Pretty-print JSON output

Examples
  $ ekairos dataset create --rows-file rows.jsonl --app-id app_x --admin-token tok_y
  $ ekairos dataset create --rows '[{"id":"1","price":10}]' --pretty
`,
    {
      importMeta: import.meta,
      argv: rawArgs,
      flags: {
        appId: { type: "string" },
        adminToken: { type: "string" },
        datasetId: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        rows: { type: "string" },
        rowsFile: { type: "string" },
        schema: { type: "string" },
        schemaFile: { type: "string" },
        pretty: { type: "boolean", default: false },
      },
    },
  );

  const flags = datasetCli.flags as DatasetCreateFlags;
  const { appId, adminToken } = resolveInstantCredentials(flags);

  if (!appId || !adminToken) {
    console.error(
      toJson(
        {
          ok: false,
          error:
            "Missing Instant credentials. Provide --app-id and --admin-token (or env vars).",
        },
        flags.pretty,
      ),
    );
    process.exit(1);
  }

  const rows = await loadRows(flags);
  const schema = await loadSchema(flags, rows);
  const datasetId = flags.datasetId || newId();
  const title = flags.title || `dataset:${datasetId}`;
  const status = flags.status || "completed";

  const db = init({
    appId,
    adminToken,
    schema: datasetDomain.toInstantSchema(),
  });
  const service = new DatasetService(db as any);

  const createResult = await service.createDataset({
    id: datasetId,
    title,
    status: "created",
    schema,
  });

  if (!createResult.ok) {
    console.error(toJson({ ok: false, error: createResult.error }, flags.pretty));
    process.exit(1);
  }

  const records = rows.map((row, idx) => ({
    rowContent: row,
    order: idx,
  }));

  const addResult = await service.addDatasetRecords({
    datasetId,
    records,
  });

  if (!addResult.ok) {
    console.error(toJson({ ok: false, error: addResult.error }, flags.pretty));
    process.exit(1);
  }

  const statusResult = await service.updateDatasetStatus({
    datasetId,
    status,
    calculatedTotalRows: rows.length,
    actualGeneratedRowCount: rows.length,
  });

  if (!statusResult.ok) {
    console.error(toJson({ ok: false, error: statusResult.error }, flags.pretty));
    process.exit(1);
  }

  console.log(
    toJson(
      {
        ok: true,
        datasetId,
        title,
        status,
        rowCount: rows.length,
      },
      flags.pretty,
    ),
  );
}

export async function runDatasetCommand(commandArgs: string[]) {
  const [subcommand, ...rest] = commandArgs;
  if (!subcommand || subcommand === "create") {
    await runDatasetCreate(rest);
    return;
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    await runDatasetCreate(["--help"]);
    return;
  }

  console.error(
    JSON.stringify(
      { ok: false, error: `Unknown dataset command: ${subcommand}` },
      null,
      2,
    ),
  );
  process.exit(1);
}
