import fs from "node:fs/promises";
import path from "node:path";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      out[key] = deepMerge(baseValue, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function getRunRoot(runId) {
  return path.resolve("artifacts", "runs", String(runId || "").trim());
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export async function writeRunArtifactJson(params) {
  const runId = String(params.runId || "").trim();
  if (!runId) throw new Error("writeRunArtifactJson requires runId.");
  const section = String(params.section || "").trim();
  const filename = String(params.filename || "").trim();
  if (!section || !filename) {
    throw new Error("writeRunArtifactJson requires section and filename.");
  }

  const runRoot = getRunRoot(runId);
  const target = path.join(runRoot, section, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(params.payload ?? null, null, 2), "utf8");
  return target;
}

export async function copyFileToRunArtifacts(params) {
  const runId = String(params.runId || "").trim();
  if (!runId) throw new Error("copyFileToRunArtifacts requires runId.");
  const section = String(params.section || "").trim();
  const filename = String(params.filename || "").trim();
  const source = path.resolve(String(params.source || "").trim());
  if (!section || !filename || !source) {
    throw new Error("copyFileToRunArtifacts requires section, filename, and source.");
  }
  const runRoot = getRunRoot(runId);
  const target = path.join(runRoot, section, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return target;
}

export async function updateRunManifest(params) {
  const runId = String(params.runId || "").trim();
  if (!runId) throw new Error("updateRunManifest requires runId.");
  const runRoot = getRunRoot(runId);
  const manifestFile = path.join(runRoot, "manifest.json");
  const now = new Date().toISOString();
  const current =
    (await readJsonIfExists(manifestFile)) || {
      runId,
      createdAt: now,
      updatedAt: now,
      stages: {},
      notes: [],
    };
  const patch = isPlainObject(params.patch) ? params.patch : {};
  const merged = deepMerge(current, patch);
  merged.runId = runId;
  merged.updatedAt = now;
  if (!merged.createdAt) merged.createdAt = now;
  if (!merged.stages || typeof merged.stages !== "object") merged.stages = {};
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  await fs.writeFile(manifestFile, JSON.stringify(merged, null, 2), "utf8");
  return manifestFile;
}
