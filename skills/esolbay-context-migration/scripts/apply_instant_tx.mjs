#!/usr/bin/env node
import fs from "node:fs/promises";
import { writeMigrationAudit } from "./_migration_audit.mjs";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const appId = arg("app-id", "");
  const token = arg("token", "");
  const input = arg("input");
  const dryRun = hasFlag("dry-run");
  const allowDestructive = hasFlag("allow-destructive");
  const orgId = arg("org", "");
  const envName = arg("env", "production");
  const runId = arg("run-id", `run-${Date.now()}`);

  if (!appId || !token || !input) {
    throw new Error("Missing required args: --app-id --token --input");
  }

  const transformed = JSON.parse((await fs.readFile(input, "utf8")).replace(/^\uFEFF/, ""));
  const providedTx = Array.isArray(transformed.tx) ? transformed.tx : null;
  const records = Array.isArray(transformed.records) ? transformed.records : [];
  const linkIntents = Array.isArray(transformed.linkIntents)
    ? transformed.linkIntents
    : [];
  const txSource = providedTx ? "input.tx" : "records->upsert";
  await writeMigrationAudit({
    runId,
    script: "apply_instant_tx",
    stage: "snapshot",
    orgId,
    envName,
    payload: {
      input,
      records: records.length,
      providedTx: providedTx ? providedTx.length : 0,
      linkIntents: linkIntents.length,
      dryRun,
      txSource,
    },
  });

  const tx = providedTx
    ? providedTx
    : records.map((r) => ({
        op: "upsert",
        entity: r.entity,
        id: r.id,
        data: r.data,
      }));
  const destructiveOps = tx.filter((item) => {
    const op = String(item?.op || "").toLowerCase();
    return op === "delete";
  });

  if (destructiveOps.length > 0 && !allowDestructive) {
    throw new Error(
      `Refusing destructive transaction: detected ${destructiveOps.length} delete ops. ` +
        "Re-run with --allow-destructive if this was explicitly reviewed.",
    );
  }

  if (!providedTx && linkIntents.length > 0) {
    console.warn(
      `[apply_instant_tx] input contains ${linkIntents.length} linkIntents but no explicit tx. ` +
        "Only upsert records will be applied in this run.",
    );
  }

  if (dryRun) {
    await writeMigrationAudit({
      runId,
      script: "apply_instant_tx",
      stage: "final",
      orgId,
      envName,
      payload: {
        mode: "dry-run",
        txCount: tx.length,
        txSource,
        linkIntents: linkIntents.length,
        destructiveOps: destructiveOps.length,
        allowDestructive,
      },
    });
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          txCount: tx.length,
          txSource,
          linkIntents: linkIntents.length,
          destructiveOps: destructiveOps.length,
          allowDestructive,
        },
        null,
        2,
      ),
    );
    return;
  }

  const endpoint = `https://api.instantdb.com/admin/v1/apps/${appId}/transact`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tx }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Instant transact failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  await writeMigrationAudit({
    runId,
    script: "apply_instant_tx",
    stage: "final",
    orgId,
    envName,
    payload: {
      mode: "apply",
      txCount: tx.length,
      txSource,
      linkIntents: linkIntents.length,
      destructiveOps: destructiveOps.length,
      allowDestructive,
      ok: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        txCount: tx.length,
        txSource,
        linkIntents: linkIntents.length,
        destructiveOps: destructiveOps.length,
        allowDestructive,
        payload,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
