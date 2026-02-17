#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFiles } from "./_env.mjs";
import { resolveInstantCredentialsFromClerk } from "./_clerk_instant.mjs";

loadEnvFiles();

const INSTANT_API = "https://api.instantdb.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function nowIso() {
  return new Date().toISOString();
}

function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

async function adminQuery(appId, adminToken, query) {
  const response = await fetch(`${INSTANT_API}/admin/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "app-id": String(appId),
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`admin/query failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function adminTransact(appId, adminToken, steps) {
  const response = await fetch(`${INSTANT_API}/admin/transact`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "app-id": String(appId),
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ steps }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`admin/transact failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function transactBatched(appId, adminToken, steps, batchSize = 200) {
  const results = [];
  for (let i = 0; i < steps.length; i += batchSize) {
    const batch = steps.slice(i, i + batchSize);
    const result = await adminTransact(appId, adminToken, batch);
    results.push({
      from: i,
      to: i + batch.length - 1,
      size: batch.length,
      result,
    });
  }
  return results;
}

function parseTs(value) {
  if (!value) return null;
  const t = new Date(value).toISOString();
  return Number.isNaN(new Date(t).getTime()) ? null : t;
}

function pickBody(msg) {
  const body = String(msg?.body || "").trim();
  if (body) return body;
  const rawBody = String(msg?.rawData?.Body || msg?.rawData?.body || "").trim();
  if (rawBody) return rawBody;
  return "";
}

function normalizeDirection(direction) {
  return String(direction || "").toLowerCase() === "outbound" ? "outbound" : "inbound";
}

function typeFromDirection(direction) {
  return normalizeDirection(direction) === "outbound" ? "assistant.message" : "user.message";
}

function roleFromDirection(direction) {
  return normalizeDirection(direction) === "outbound" ? "assistant" : "user";
}

async function main() {
  const orgId = String(arg("org", "")).trim();
  const tenderId = String(arg("tender-id", "")).trim();
  const clerkSecretKey = String(arg("clerk-secret", process.env.CLERK_SECRET_KEY || "")).trim();
  const clerkApiUri = String(arg("clerk-api-uri", "https://api.clerk.com")).trim();
  const runId = String(arg("run-id", `conversation-bridge-${Date.now()}`)).trim();
  const dryRun = hasFlag("dry-run");

  if (!orgId) throw new Error("Missing required arg: --org");
  if (!tenderId) throw new Error("Missing required arg: --tender-id");
  if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY.");

  const scriptFile = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(scriptFile);
  const skillRoot = path.resolve(scriptsDir, "..");
  const reportsDir = path.join(skillRoot, "artifacts", "reports");
  const datasetsDir = path.join(skillRoot, "artifacts", "datasets");
  const transformedDir = path.join(skillRoot, "artifacts", "transformed");

  await fs.mkdir(reportsDir, { recursive: true });
  await fs.mkdir(datasetsDir, { recursive: true });
  await fs.mkdir(transformedDir, { recursive: true });

  const target = await resolveInstantCredentialsFromClerk({
    orgId,
    clerkSecretKey,
    clerkApiUri,
  });
  const appId = String(target.appId || "").trim();
  const adminToken = String(target.adminToken || "").trim();

  const startedAt = nowIso();

  const awardsRes = await adminQuery(appId, adminToken, {
    award_awards: {
      $: { where: { "tender.id": tenderId } },
      tender: {},
      supplier_company: {},
      supplier_assignements: { company: {}, contact: {} },
    },
  });
  const awards = Array.isArray(awardsRes?.award_awards) ? awardsRes.award_awards : [];
  if (awards.length === 0) {
    throw new Error(`No awards found for tender ${tenderId}.`);
  }

  const whatsappRes = await adminQuery(appId, adminToken, {
    whatsapp_messages: {},
  });
  const conversationRes = await adminQuery(appId, adminToken, {
    conversation_messages: {},
  });
  const existingContextRes = await adminQuery(appId, adminToken, {
    thread_contexts: {},
    thread_items: { whatsappMessages: {}, context: {}, thread: {} },
  });

  const whatsappMessages = Array.isArray(whatsappRes?.whatsapp_messages) ? whatsappRes.whatsapp_messages : [];
  const conversationMessages = Array.isArray(conversationRes?.conversation_messages)
    ? conversationRes.conversation_messages
    : [];
  const existingContexts = Array.isArray(existingContextRes?.thread_contexts) ? existingContextRes.thread_contexts : [];
  const existingItems = Array.isArray(existingContextRes?.thread_items) ? existingContextRes.thread_items : [];

  const tenderSeed = whatsappMessages.filter((m) => {
    const body = pickBody(m);
    return body.includes(tenderId);
  });
  const conversationIds = Array.from(
    new Set(
      tenderSeed
        .map((m) => String(m?.conversation || "").trim())
        .filter(Boolean),
    ),
  );
  if (conversationIds.length === 0) {
    throw new Error(`No whatsapp conversation found with tender UUID ${tenderId}.`);
  }

  const selectedWhatsappMessages = whatsappMessages
    .filter((m) => conversationIds.includes(String(m?.conversation || "").trim()))
    .filter((m) => isUuid(m?.id))
    .sort((a, b) => {
      const at = new Date(a?.createdAt || 0).getTime();
      const bt = new Date(b?.createdAt || 0).getTime();
      if (at !== bt) return at - bt;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });

  const selectedWhatsappIds = new Set(selectedWhatsappMessages.map((m) => String(m.id)));
  const selectedConversationMessages = conversationMessages.filter((m) => {
    const linkedWhatsapp = String(m?.whatsappMessage || "").trim();
    return linkedWhatsapp && selectedWhatsappIds.has(linkedWhatsapp);
  });

  const minCreatedAt = parseTs(selectedWhatsappMessages[0]?.createdAt) || nowIso();
  const maxUpdatedAt = parseTs(selectedWhatsappMessages[selectedWhatsappMessages.length - 1]?.updatedAt) || nowIso();

  const steps = [];
  const plan = [];

  for (const award of awards) {
    const awardId = String(award?.id || "").trim();
    if (!isUuid(awardId)) continue;
    const contextKey = `award_${awardId}`;

    const existingCtx = existingContexts.find((ctx) => String(ctx?.key || "") === contextKey);
    const contextId = isUuid(existingCtx?.id) ? String(existingCtx.id) : awardId;
    const threadId = contextId;

    steps.push([
      "update",
      "thread_threads",
      threadId,
      {
        key: contextKey,
        name: contextKey,
        status: "open",
        createdAt: parseTs(existingCtx?.createdAt) || minCreatedAt,
        updatedAt: maxUpdatedAt,
      },
    ]);
    steps.push([
      "update",
      "thread_contexts",
      contextId,
      {
        key: contextKey,
        status: "open",
        content: {},
        createdAt: parseTs(existingCtx?.createdAt) || minCreatedAt,
        updatedAt: maxUpdatedAt,
      },
    ]);
    steps.push(["link", "thread_contexts", contextId, { thread: threadId }]);

    for (const msg of selectedWhatsappMessages) {
      const msgId = String(msg?.id || "").trim();
      if (!isUuid(msgId)) continue;
      const contentText = pickBody(msg);
      const createdAt = parseTs(msg?.createdAt) || nowIso();
      const updatedAt = parseTs(msg?.updatedAt) || createdAt;
      const direction = normalizeDirection(msg?.direction);
      const type = typeFromDirection(direction);
      const role = roleFromDirection(direction);

      steps.push([
        "update",
        "thread_items",
        msgId,
        {
          type,
          role,
          channel: "whatsapp",
          status: "stored",
          content: {
            text: contentText,
            parts: [{ type: "text", text: contentText }],
          },
          createdAt,
          updatedAt,
        },
      ]);
      steps.push([
        "link",
        "thread_items",
        msgId,
        {
          context: contextId,
          thread: threadId,
          whatsappMessages: [msgId],
        },
      ]);
    }

    for (const cm of selectedConversationMessages) {
      const cmId = String(cm?.id || "").trim();
      const msgId = String(cm?.whatsappMessage || "").trim();
      if (!isUuid(cmId) || !isUuid(msgId)) continue;
      steps.push([
        "link",
        "conversation_messages",
        cmId,
        {
          context: contextId,
          event: msgId,
        },
      ]);
    }

    plan.push({
      awardId,
      contextKey,
      contextId,
      threadId,
      whatsappMessages: selectedWhatsappMessages.length,
      conversationMessages: selectedConversationMessages.length,
    });
  }

  const sourceSnapshot = {
    runId,
    orgId,
    tenderId,
    appId,
    startedAt,
    awards: awards.map((a) => ({
      id: a.id,
      supplier: a?.supplier_company?.[0]?.name || null,
    })),
    conversationIds,
    whatsappMessages: selectedWhatsappMessages,
    conversationMessages: selectedConversationMessages,
    existingContexts: existingContexts.filter((ctx) =>
      awards.some((a) => String(ctx?.key || "") === `award_${String(a?.id || "")}`),
    ),
    existingItems: existingItems.filter((it) => selectedWhatsappIds.has(String(it?.id || ""))),
  };

  const txPlan = {
    runId,
    orgId,
    tenderId,
    appId,
    dryRun,
    generatedAt: nowIso(),
    steps,
    plan,
  };

  const sourceFile = path.join(datasetsDir, `conversation-bridge.source.${runId}.json`);
  const txFile = path.join(transformedDir, `conversation-bridge.tx.${runId}.json`);
  await fs.writeFile(sourceFile, JSON.stringify(sourceSnapshot, null, 2), "utf8");
  await fs.writeFile(txFile, JSON.stringify(txPlan, null, 2), "utf8");

  let applyResult = { dryRun, batches: [] };
  if (!dryRun && steps.length > 0) {
    applyResult = {
      dryRun,
      batches: await transactBatched(appId, adminToken, steps, 200),
    };
  }

  const verifyQuery = {
    thread_contexts: {
      $: {
        where: {
          or: awards.map((a) => ({ key: `award_${String(a.id)}` })),
        },
      },
      thread: {},
      items: { whatsappMessages: {} },
      messages: { event: {}, whatsappMessage: {} },
    },
    thread_items: {
      $: {
        where: {
          id: { $in: selectedWhatsappMessages.map((m) => m.id) },
        },
      },
      context: {},
      thread: {},
      whatsappMessages: {},
      message: {},
    },
  };
  const verify = await adminQuery(appId, adminToken, verifyQuery);

  const report = {
    ok: true,
    runId,
    orgId,
    tenderId,
    appId,
    dryRun,
    startedAt,
    endedAt: nowIso(),
    awards: plan,
    conversationIds,
    sourceCounts: {
      whatsappMessages: selectedWhatsappMessages.length,
      conversationMessages: selectedConversationMessages.length,
    },
    tx: {
      steps: steps.length,
      batches: applyResult?.batches?.length || 0,
    },
    verifyCounts: {
      thread_contexts: Array.isArray(verify?.thread_contexts) ? verify.thread_contexts.length : 0,
      thread_items: Array.isArray(verify?.thread_items) ? verify.thread_items.length : 0,
    },
    files: {
      sourceFile,
      txFile,
    },
  };

  const reportFile = path.join(reportsDir, `conversation-bridge.report.${runId}.json`);
  await fs.writeFile(reportFile, `${JSON.stringify({ ...report, verify }, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
}

main().catch((error) => {
  console.error(String(error?.stack || error?.message || error));
  process.exit(1);
});
