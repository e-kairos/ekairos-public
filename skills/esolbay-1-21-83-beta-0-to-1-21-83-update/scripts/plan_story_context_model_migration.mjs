#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFiles } from "./_env.mjs";

loadEnvFiles();
const execFileAsync = promisify(execFile);

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function normalizeRepoRoot(value) {
  return path.resolve(String(value || "."));
}

function rel(filePath, repoRoot) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

async function rgLines(repo, pattern) {
  try {
    const { stdout } = await execFileAsync("rg", ["-n", "-e", pattern, repo], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
    });
    return String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const out = String(error?.stdout || "");
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

function parseFileAndLine(rgLine, repoRoot) {
  const first = rgLine.indexOf(":");
  const second = rgLine.indexOf(":", first + 1);
  if (first <= 0 || second <= first) {
    return { file: rel(rgLine, repoRoot), line: null, raw: rgLine };
  }
  const abs = rgLine.slice(0, first);
  const lineRaw = rgLine.slice(first + 1, second);
  const line = Number(lineRaw);
  return {
    file: rel(abs, repoRoot),
    line: Number.isFinite(line) ? line : null,
    raw: rgLine,
  };
}

function uniqByFileAndLine(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = `${entry.file}:${entry.line || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function toSamples(entries, limit = 25) {
  return entries
    .slice(0, limit)
    .map((entry) => (entry.line ? `${entry.file}:${entry.line}` : entry.file));
}

function summarizePatternResult(name, pattern, lines, repoRoot) {
  const entries = uniqByFileAndLine(lines.map((line) => parseFileAndLine(line, repoRoot)));
  const files = Array.from(new Set(entries.map((entry) => entry.file))).sort();
  return {
    name,
    pattern,
    matches: entries.length,
    filesCount: files.length,
    files,
    entries,
    sample: toSamples(entries),
  };
}

function buildActionItems(report) {
  const items = [];
  if (report.summary.legacyModelMatches > 0) {
    items.push("Create and run dataset transform for legacy story entities into context entities.");
  }
  if (report.summary.legacyApiMatches > 0) {
    items.push("Replace story runtime APIs (`useStory`, `createStory`, `InstantStore`) with context runtime APIs.");
  }
  if (report.summary.contextModelMatches === 0) {
    items.push("Add context model reads/writes (`context_contexts`, `context_items`, ... ) in migrated surfaces.");
  }
  if (report.summary.reactorMatches === 0) {
    items.push("Configure explicit reactor for migrated agents (`.reactor(...)` or `create*Reactor`).");
  }
  if (items.length === 0) {
    items.push("No model migration gaps detected by static scan.");
  }
  return items;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Story -> Context Model Migration Plan");
  lines.push("");
  lines.push(`- Generated: ${report.createdAt}`);
  lines.push(`- Repo: \`${report.repo}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Legacy model matches: **${report.summary.legacyModelMatches}**`);
  lines.push(`- Legacy API matches: **${report.summary.legacyApiMatches}**`);
  lines.push(`- Context model matches: **${report.summary.contextModelMatches}**`);
  lines.push(`- Context API matches: **${report.summary.contextApiMatches}**`);
  lines.push(`- Reactor matches: **${report.summary.reactorMatches}**`);
  lines.push(`- Ready for model migration completion: **${report.summary.ready ? "yes" : "no"}**`);
  lines.push("");
  lines.push("## Entity Mapping");
  lines.push("");
  lines.push("| Legacy | Target | Notes |");
  lines.push("| --- | --- | --- |");
  for (const row of report.mapping.entities) {
    lines.push(`| ${row.from} | ${row.to.join(", ")} | ${row.notes} |`);
  }
  lines.push("");
  lines.push("## Action Items");
  lines.push("");
  let i = 1;
  for (const item of report.actionItems) {
    lines.push(`${i}. ${item}`);
    i += 1;
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  for (const section of report.findings.sections) {
    lines.push(`### ${section.title}`);
    lines.push("");
    lines.push(`- Matches: **${section.totalMatches}**`);
    lines.push(`- Files: **${section.totalFiles}**`);
    if (section.sample.length > 0) {
      lines.push(`- Sample: ${section.sample.map((s) => `\`${s}\``).join(", ")}`);
    } else {
      lines.push("- Sample: none");
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const repo = normalizeRepoRoot(arg("repo", "."));
  const outJson = path.resolve(arg("out-json", "./artifacts/reports/story-context-model-plan.json"));
  const outMd = path.resolve(arg("out-md", "./artifacts/reports/story-context-model-plan.md"));

  const legacyModelPatterns = [
    { name: "context_contexts", pattern: "\\bcontext_contexts\\b" },
    { name: "context_events", pattern: "\\bcontext_events\\b" },
    { name: "story_executions", pattern: "\\bstory_executions\\b" },
    { name: "story_steps", pattern: "\\bstory_steps\\b" },
    { name: "story_parts", pattern: "\\bstory_parts\\b" },
  ];

  const legacyApiPatterns = [
    { name: "@ekairos/story import", pattern: "@ekairos/story|ekairos/story" },
    { name: "useStory", pattern: "\\buseStory\\s*\\(" },
    { name: "createStory", pattern: "\\bcreateStory\\s*\\(" },
    { name: "InstantStore", pattern: "\\bInstantStore\\b" },
  ];

  const contextModelPatterns = [
    { name: "context_contexts", pattern: "\\bcontext_contexts\\b" },
    { name: "context_contexts", pattern: "\\bcontext_contexts\\b" },
    { name: "context_items", pattern: "\\bcontext_items\\b" },
    { name: "context_executions", pattern: "\\bcontext_executions\\b" },
    { name: "context_steps", pattern: "\\bcontext_steps\\b" },
    { name: "context_parts", pattern: "\\bcontext_parts\\b" },
  ];

  const contextApiPatterns = [
    { name: "@ekairos/events import", pattern: "@ekairos/events|ekairos/context" },
    { name: "createContext", pattern: "\\bcreateContext\\s*\\(" },
    { name: "context/start rpc", pattern: "context/start" },
  ];

  const reactorPatterns = [
    { name: "reactor builder", pattern: "\\.reactor\\s*\\(" },
    { name: "reactor factory", pattern: "\\bcreate[A-Za-z0-9]*Reactor\\s*\\(" },
    { name: "reactor field", pattern: "\\breactor\\s*:" },
  ];

  const scanGroup = async (title, patterns) => {
    const items = [];
    for (const entry of patterns) {
      const lines = await rgLines(repo, entry.pattern);
      items.push(summarizePatternResult(entry.name, entry.pattern, lines, repo));
    }
    const totalMatches = items.reduce((acc, item) => acc + item.matches, 0);
    const totalFiles = new Set(items.flatMap((item) => item.files)).size;
    const sample = items.flatMap((item) => item.sample).slice(0, 20);
    return { title, totalMatches, totalFiles, sample, items };
  };

  const legacyModel = await scanGroup("Legacy Model", legacyModelPatterns);
  const legacyApi = await scanGroup("Legacy API", legacyApiPatterns);
  const contextModel = await scanGroup("Context Model", contextModelPatterns);
  const contextApi = await scanGroup("Context API", contextApiPatterns);
  const reactor = await scanGroup("Reactor", reactorPatterns);

  const report = {
    createdAt: new Date().toISOString(),
    repo,
    mapping: {
      entities: [
        {
          from: "context_contexts",
          to: ["context_contexts", "context_contexts"],
          notes: "one context maps to one context record and one context record",
        },
        {
          from: "context_events",
          to: ["context_items"],
          notes: "preserve ids and content parts when possible",
        },
        {
          from: "story_executions",
          to: ["context_executions"],
          notes: "preserve workflowRunId/status and link context/context",
        },
        {
          from: "story_steps",
          to: ["context_steps"],
          notes: "preserve iteration, event ids, tool call metadata",
        },
        {
          from: "story_parts",
          to: ["context_parts"],
          notes: "preserve per-step normalized parts",
        },
      ],
    },
    findings: {
      sections: [legacyModel, legacyApi, contextModel, contextApi, reactor],
    },
    summary: {
      legacyModelMatches: legacyModel.totalMatches,
      legacyApiMatches: legacyApi.totalMatches,
      contextModelMatches: contextModel.totalMatches,
      contextApiMatches: contextApi.totalMatches,
      reactorMatches: reactor.totalMatches,
      ready:
        legacyModel.totalMatches === 0 &&
        legacyApi.totalMatches === 0 &&
        contextModel.totalMatches > 0 &&
        contextApi.totalMatches > 0 &&
        reactor.totalMatches > 0,
    },
  };

  report.actionItems = buildActionItems(report);

  await fs.mkdir(path.dirname(outJson), { recursive: true });
  await fs.writeFile(outJson, JSON.stringify(report, null, 2), "utf8");
  await fs.mkdir(path.dirname(outMd), { recursive: true });
  await fs.writeFile(outMd, renderMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        outJson,
        outMd,
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

