#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { writeMigrationAudit } from "./_migration_audit.mjs";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeId(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toIso(value, fallback) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function normalizeContextStatus(value) {
  const raw = String(value || "open").toLowerCase();
  if (raw === "streaming") return "streaming";
  if (raw === "closed") return "closed";
  if (raw === "failed") return "failed";
  return "open";
}

function normalizeExecutionStatus(value) {
  const raw = String(value || "completed").toLowerCase();
  if (raw === "executing" || raw === "running") return "executing";
  if (raw === "failed") return "failed";
  return "completed";
}

function normalizeStepStatus(value) {
  const raw = String(value || "completed").toLowerCase();
  if (raw === "running") return "running";
  if (raw === "failed") return "failed";
  return "completed";
}

function firstLinkedId(value) {
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    return safeId(first?.id || first);
  }
  if (value && typeof value === "object") {
    return safeId(value.id);
  }
  return "";
}

function resolveDataRoot(source) {
  if (source && typeof source === "object") {
    if (source.payload && typeof source.payload === "object" && source.payload.data && typeof source.payload.data === "object") {
      return source.payload.data;
    }
    if (source.data && typeof source.data === "object") return source.data;
    if (source.payload && typeof source.payload === "object") return source.payload;
    return source;
  }
  return {};
}

function createRecord(entity, id, data) {
  return {
    entity,
    id,
    data,
  };
}

function createLinkIntent(entity, id, links) {
  return {
    entity,
    id,
    links,
  };
}

function parseJsonText(value) {
  const raw = String(value || "").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function dedupeRecords(records) {
  const map = new Map();
  for (const record of records) {
    const key = `${record.entity}:${record.id}`;
    map.set(key, record);
  }
  return Array.from(map.values());
}

function dedupeLinkIntents(intents) {
  const map = new Map();
  for (const item of intents) {
    const key = `${item.entity}:${item.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, links: { ...(item.links || {}) } });
      continue;
    }
    map.set(key, {
      ...existing,
      links: {
        ...(existing.links || {}),
        ...(item.links || {}),
      },
    });
  }
  return Array.from(map.values());
}

function countByEntity(records) {
  const out = {};
  for (const record of records) {
    out[record.entity] = (out[record.entity] || 0) + 1;
  }
  return out;
}

function transformStoryToThread(sourcePayload) {
  const source = resolveDataRoot(sourcePayload);
  const now = new Date().toISOString();
  const warnings = [];
  const records = [];
  const linkIntents = [];

  const legacyContexts = toArray(source.context_contexts);
  const legacyEvents = toArray(source.context_events);
  const legacyExecutions = toArray(source.story_executions);
  const legacySteps = toArray(source.story_steps);
  const legacyParts = toArray(source.story_parts);

  const contextToThread = new Map();
  const contextKeyToId = new Map();

  for (const context of legacyContexts) {
    const contextId = safeId(context?.id);
    if (!contextId) {
      warnings.push("context_contexts row skipped: missing id");
      continue;
    }
    const threadId =
      firstLinkedId(context?.thread) ||
      safeId(context?.threadId) ||
      `thread_${contextId}`;
    const key = typeof context?.key === "string" ? context.key : undefined;
    if (key) contextKeyToId.set(key, contextId);
    contextToThread.set(contextId, threadId);

    records.push(
      createRecord("thread_threads", threadId, {
        createdAt: toIso(context?.createdAt, now),
        updatedAt: toIso(context?.updatedAt, undefined),
        key,
        name:
          typeof context?.content?.title === "string"
            ? context.content.title
            : key,
        status: normalizeContextStatus(context?.status),
      }),
    );

    records.push(
      createRecord("thread_contexts", contextId, {
        createdAt: toIso(context?.createdAt, now),
        updatedAt: toIso(context?.updatedAt, undefined),
        status: normalizeContextStatus(context?.status),
        content: context?.content ?? undefined,
      }),
    );

    linkIntents.push(createLinkIntent("thread_contexts", contextId, { thread: threadId }));
  }

  const eventToExecution = new Map();

  for (const execution of legacyExecutions) {
    const executionId = safeId(execution?.id);
    if (!executionId) {
      warnings.push("story_executions row skipped: missing id");
      continue;
    }
    const contextId =
      firstLinkedId(execution?.context) ||
      safeId(execution?.contextId) ||
      safeId(execution?.context_id);
    const threadId =
      (contextId && contextToThread.get(contextId)) ||
      firstLinkedId(execution?.thread) ||
      safeId(execution?.threadId) ||
      "";
    const triggerEventId =
      firstLinkedId(execution?.trigger) ||
      safeId(execution?.triggerEventId) ||
      safeId(execution?.trigger_event_id);
    const reactionEventId =
      firstLinkedId(execution?.reaction) ||
      safeId(execution?.reactionEventId) ||
      safeId(execution?.reaction_event_id);

    if (triggerEventId) eventToExecution.set(triggerEventId, executionId);
    if (reactionEventId) eventToExecution.set(reactionEventId, executionId);

    records.push(
      createRecord("thread_executions", executionId, {
        createdAt: toIso(execution?.createdAt, now),
        updatedAt: toIso(execution?.updatedAt, undefined),
        status: normalizeExecutionStatus(execution?.status),
        workflowRunId:
          safeId(execution?.workflowRunId) ||
          safeId(execution?.runId) ||
          safeId(execution?.workflow_run_id) ||
          undefined,
      }),
    );

    if (contextId) {
      linkIntents.push(createLinkIntent("thread_executions", executionId, { context: contextId }));
    } else {
      warnings.push(`story_executions ${executionId}: missing context link`);
    }
    if (threadId) {
      linkIntents.push(createLinkIntent("thread_executions", executionId, { thread: threadId }));
    } else {
      warnings.push(`story_executions ${executionId}: missing thread link`);
    }
    if (triggerEventId) {
      linkIntents.push(createLinkIntent("thread_executions", executionId, { trigger: triggerEventId }));
    }
    if (reactionEventId) {
      linkIntents.push(createLinkIntent("thread_executions", executionId, { reaction: reactionEventId }));
    }
    if (contextId) {
      linkIntents.push(createLinkIntent("thread_contexts", contextId, { currentExecution: executionId }));
    }
  }

  for (const event of legacyEvents) {
    const eventId = safeId(event?.id);
    if (!eventId) {
      warnings.push("context_events row skipped: missing id");
      continue;
    }

    const contextId =
      firstLinkedId(event?.context) ||
      safeId(event?.contextId) ||
      safeId(event?.context_id) ||
      (typeof event?.contextKey === "string" ? contextKeyToId.get(event.contextKey) || "" : "");
    const threadId =
      (contextId && contextToThread.get(contextId)) ||
      firstLinkedId(event?.thread) ||
      safeId(event?.threadId) ||
      "";
    const executionId =
      firstLinkedId(event?.execution) ||
      safeId(event?.executionId) ||
      safeId(event?.execution_id) ||
      eventToExecution.get(eventId) ||
      "";

    records.push(
      createRecord("thread_items", eventId, {
        channel:
          typeof event?.channel === "string" && event.channel
            ? event.channel
            : "web",
        createdAt: toIso(event?.createdAt, now),
        type: typeof event?.type === "string" ? event.type : undefined,
        content: event?.content ?? undefined,
        status: typeof event?.status === "string" ? event.status : undefined,
      }),
    );

    if (contextId) {
      linkIntents.push(createLinkIntent("thread_items", eventId, { context: contextId }));
    } else {
      warnings.push(`context_events ${eventId}: missing context link`);
    }
    if (threadId) {
      linkIntents.push(createLinkIntent("thread_items", eventId, { thread: threadId }));
    } else {
      warnings.push(`context_events ${eventId}: missing thread link`);
    }
    if (executionId) {
      linkIntents.push(createLinkIntent("thread_items", eventId, { execution: executionId }));
    }
  }

  for (const step of legacySteps) {
    const stepId = safeId(step?.id);
    if (!stepId) {
      warnings.push("story_steps row skipped: missing id");
      continue;
    }
    const executionId =
      firstLinkedId(step?.execution) ||
      safeId(step?.executionId) ||
      safeId(step?.execution_id);
    const triggerEventId =
      safeId(step?.triggerEventId) ||
      safeId(step?.trigger_event_id) ||
      firstLinkedId(step?.trigger);
    const reactionEventId =
      safeId(step?.reactionEventId) ||
      safeId(step?.reaction_event_id) ||
      firstLinkedId(step?.reaction);
    const eventId =
      safeId(step?.eventId) ||
      safeId(step?.event_id) ||
      reactionEventId ||
      triggerEventId ||
      stepId;

    records.push(
      createRecord("thread_steps", stepId, {
        createdAt: toIso(step?.createdAt, now),
        updatedAt: toIso(step?.updatedAt, undefined),
        status: normalizeStepStatus(step?.status),
        iteration:
          typeof step?.iteration === "number" && Number.isFinite(step.iteration)
            ? step.iteration
            : 0,
        executionId: executionId || undefined,
        triggerEventId: triggerEventId || undefined,
        reactionEventId: reactionEventId || undefined,
        eventId,
        toolCalls: step?.toolCalls ?? step?.tools ?? undefined,
        toolExecutionResults:
          step?.toolExecutionResults ??
          step?.toolResults ??
          step?.toolOutput ??
          undefined,
        continueLoop:
          typeof step?.continueLoop === "boolean"
            ? step.continueLoop
            : undefined,
        errorText:
          typeof step?.errorText === "string"
            ? step.errorText
            : typeof step?.error === "string"
              ? step.error
              : undefined,
      }),
    );

    if (executionId) {
      linkIntents.push(createLinkIntent("thread_steps", stepId, { execution: executionId }));
    } else {
      warnings.push(`story_steps ${stepId}: missing execution link`);
    }
  }

  for (const part of legacyParts) {
    const stepId = firstLinkedId(part?.step) || safeId(part?.stepId) || safeId(part?.step_id);
    const idx =
      typeof part?.idx === "number" && Number.isFinite(part.idx)
        ? part.idx
        : 0;
    if (!stepId) {
      warnings.push("story_parts row skipped: missing stepId");
      continue;
    }
    const partId = safeId(part?.id) || `${stepId}:${idx}`;
    const key =
      typeof part?.key === "string" && part.key.trim()
        ? part.key
        : `${stepId}:${idx}`;

    records.push(
      createRecord("thread_parts", partId, {
        key,
        stepId,
        idx,
        type:
          typeof part?.type === "string"
            ? part.type
            : typeof part?.part?.type === "string"
              ? part.part.type
              : undefined,
        part: part?.part ?? part?.content ?? part,
        updatedAt: toIso(part?.updatedAt, undefined),
      }),
    );
    linkIntents.push(createLinkIntent("thread_parts", partId, { step: stepId }));
  }

  const dedupedRecords = dedupeRecords(records);
  const dedupedLinks = dedupeLinkIntents(linkIntents);

  return {
    meta: {
      transformedAt: now,
      sourceEntities: {
        context_contexts: legacyContexts.length,
        context_events: legacyEvents.length,
        story_executions: legacyExecutions.length,
        story_steps: legacySteps.length,
        story_parts: legacyParts.length,
      },
      generatedRecords: countByEntity(dedupedRecords),
      generatedLinkIntents: dedupedLinks.length,
    },
    records: dedupedRecords,
    linkIntents: dedupedLinks,
    warnings,
  };
}

async function main() {
  const input = arg("input");
  const output = arg("output");
  const orgId = arg("org", "");
  const envName = arg("env", "production");
  const runId = arg("run-id", `run-${Date.now()}`);

  if (!input || !output) {
    throw new Error("Missing required args: --input --output");
  }

  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);

  const source = parseJsonText(await fs.readFile(inputPath, "utf8"));
  await writeMigrationAudit({
    runId,
    script: "transform_story_to_thread_dataset",
    stage: "snapshot",
    orgId,
    envName,
    payload: {
      input: inputPath,
    },
  });

  const transformed = transformStoryToThread(source);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(transformed, null, 2), "utf8");

  await writeMigrationAudit({
    runId,
    script: "transform_story_to_thread_dataset",
    stage: "final",
    orgId,
    envName,
    payload: {
      output: outputPath,
      records: transformed.records.length,
      linkIntents: transformed.linkIntents.length,
      warnings: transformed.warnings.length,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        output: outputPath,
        records: transformed.records.length,
        linkIntents: transformed.linkIntents.length,
        warnings: transformed.warnings.length,
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
