import { id, init, lookup } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { sandboxDomain } from "@ekairos/sandbox";
import { DatasetService, structureDomain } from "@ekairos/structure";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

export function getInstantEnvOrThrow() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID || process.env.INSTANT_APP_ID || process.env.INSTANTDB_APP_ID;
  const adminToken =
    process.env.INSTANT_APP_ADMIN_TOKEN || process.env.INSTANT_ADMIN_TOKEN || process.env.INSTANTDB_ADMIN_TOKEN;
  if (!appId || !adminToken) {
    throw new Error("Instant env not configured");
  }
  return { appId, adminToken };
}

export function getAdminDb(appId: string, adminToken: string) {
  const appDomain = domain("structure-workflow-e2e")
    .includes(structureDomain)
    .includes(sandboxDomain)
    .schema({ entities: {}, links: {}, rooms: {} });

  return init({ appId, adminToken, schema: appDomain.toInstantSchema() });
}

export async function uploadCsvFixture(adminDb: any, fixtureName: string) {
  const fixturePath = resolve(process.cwd(), "tests", "structure", "fixtures", fixtureName);
  const fileBuffer = await fs.readFile(fixturePath);

  const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-${fixtureName}`;
  const uploadResult = await adminDb.storage.uploadFile(storagePath, fileBuffer, {
    contentType: "text/csv",
    contentDisposition: fixtureName,
  });

  const fileId = uploadResult?.data?.id as string;
  if (!fileId) throw new Error(`Failed to upload fixture ${fixtureName}`);
  return fileId;
}

export async function readRowsOutput(adminDb: any, datasetId: string) {
  const ds = new DatasetService(adminDb as any);
  const gen = await ds.readRecordsFromFile(datasetId);
  if (!gen.ok) return { ok: false as const, error: gen.error };

  const rows: any[] = [];
  for await (const rec of gen.data) rows.push(rec);

  const dataRows = rows.filter((r) => r?.type === "row").map((r) => r.data);
  return { ok: true as const, dataRows };
}

export async function createRowsDatasetContext(params: { adminDb: any; datasetId: string; rows: any[]; name: string }) {
  const { adminDb, datasetId, rows, name } = params;
  const contextKey = `structure:${datasetId}`;

  const jsonl = rows.map((r) => JSON.stringify({ type: "row", data: r })).join("\n") + "\n";
  const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-${name}.jsonl`;
  const uploadResult = await adminDb.storage.uploadFile(storagePath, Buffer.from(jsonl, "utf-8"), {
    contentType: "application/x-ndjson",
    contentDisposition: `${name}.jsonl`,
  });

  const fileId = uploadResult?.data?.id as string;
  if (!fileId) throw new Error("Failed to upload dataset jsonl");

  await adminDb.transact(
    adminDb.tx.thread_contexts[id()].create({
      createdAt: new Date(),
      updatedAt: new Date(),
      type: "structure",
      key: contextKey,
      status: "open",
      content: {
        structure: {
          kind: "ekairos.structure",
          version: 1,
          structureId: datasetId,
          state: "completed",
          outputs: {
            rows: { format: "jsonl", fileId },
          },
        },
      },
    }),
  );

  await adminDb.transact(adminDb.tx.thread_contexts[lookup("key", contextKey)].link({ structure_output_file: fileId }));

  return { datasetId, fileId };
}

export function extractToolParts(events: any[]) {
  const parts: any[] = [];
  for (const e of events) {
    const ps = e?.content?.parts;
    if (!Array.isArray(ps)) continue;
    for (const p of ps) {
      if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
        parts.push(p);
      }
    }
  }
  return parts;
}


