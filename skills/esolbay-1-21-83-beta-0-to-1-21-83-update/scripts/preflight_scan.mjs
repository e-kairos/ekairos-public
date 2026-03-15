#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFiles } from "./_env.mjs";

const execFileAsync = promisify(execFile);
loadEnvFiles();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

async function rg(repoPath, pattern) {
  try {
    const { stdout } = await execFileAsync("rg", ["-n", pattern, repoPath], { windowsHide: true });
    return stdout
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

async function rgFiles(root) {
  try {
    const { stdout } = await execFileAsync("rg", ["--files", root], { windowsHide: true });
    return stdout
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

function normalizeRel(filePath, repoRoot) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function extAllowed(filePath) {
  return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(filePath);
}

function isEndpointRoute(relPath) {
  return /^src\/app\/.+\/route\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath);
}

function isAgentSurface(relPath) {
  return (
    /^src\/components\/ekairos\/agent\/.+\.(ts|tsx)$/i.test(relPath) ||
    /^src\/components\/ekairos\/story\/context\/.+\.(ts|tsx)$/i.test(relPath) ||
    /^src\/lib\/domain\/.+agent.+\.(ts|tsx)$/i.test(relPath) ||
    /^src\/app\/platform\/.+Agent\.tsx$/i.test(relPath) ||
    /^src\/app\/api\/.+agent.+\/route\.(ts|tsx)$/i.test(relPath)
  );
}

function isTargetAgentEndpoint(relPath) {
  return (
    /^src\/app\/api\/.+agent.+\/route\.(ts|tsx)$/i.test(relPath) ||
    /^src\/app\/domain\/\[storyName\]\/route\.ts$/i.test(relPath)
  );
}

function scanContent(content) {
  const text = String(content || "");
  const storyImport = /@ekairos\/story|ekairos\/story/i.test(text);
  const storyApi = /\buseStory\s*\(|\bcreateStory\s*\(|\bInstantStore\b|\bStoryValue\b/i.test(text);
  const contextImport = /@ekairos\/context/i.test(text);
  const contextApi = /\bcreateContext\s*\(|\bgetContextRuntime\s*\(|context\/start\b/i.test(text);
  const reactor = /\bcreate[A-Za-z0-9]*Reactor\s*\(|\.reactor\s*\(|\breactor\s*:/i.test(text);
  return {
    storyImport,
    storyApi,
    contextImport,
    contextApi,
    reactor,
  };
}

async function main() {
  const repo = arg("repo");
  const out = arg("out");
  if (!repo || !out) {
    throw new Error("usage: preflight_scan.mjs --repo <path> --out <file>");
  }

  const srcRoot = path.join(repo, "src");
  let scanRoot = repo;
  try {
    const srcStat = await fs.stat(srcRoot);
    if (srcStat.isDirectory()) {
      scanRoot = srcRoot;
    }
  } catch {
    scanRoot = repo;
  }

  const allFiles = (await rgFiles(scanRoot))
    .filter(extAllowed)
    .map((filePath) => ({
      abs: filePath,
      rel: normalizeRel(filePath, repo),
    }));

  const endpointFiles = allFiles.filter((file) => isEndpointRoute(file.rel));
  const agentFiles = allFiles.filter((file) => isAgentSurface(file.rel));
  const targetAgentEndpoints = endpointFiles.filter((file) => isTargetAgentEndpoint(file.rel));

  const endpointStoryRefs = [];
  const endpointContextRefs = [];
  const endpointReactorRefs = [];
  const endpointMissingContextEvidence = [];

  const agentStoryRefs = [];
  const agentContextRefs = [];
  const agentReactorRefs = [];
  const agentContextWithoutReactor = [];

  for (const file of endpointFiles) {
    const content = await fs.readFile(file.abs, "utf8");
    const flags = scanContent(content);
    if (flags.storyImport || flags.storyApi) endpointStoryRefs.push(file.rel);
    if (flags.contextImport || flags.contextApi) endpointContextRefs.push(file.rel);
    if (flags.reactor) endpointReactorRefs.push(file.rel);
    if (
      targetAgentEndpoints.some((target) => target.rel === file.rel) &&
      !(flags.contextImport || flags.contextApi || flags.reactor)
    ) {
      endpointMissingContextEvidence.push(file.rel);
    }
  }

  for (const file of agentFiles) {
    const content = await fs.readFile(file.abs, "utf8");
    const flags = scanContent(content);
    if (flags.storyImport || flags.storyApi) agentStoryRefs.push(file.rel);
    if (flags.contextImport || flags.contextApi) agentContextRefs.push(file.rel);
    if (flags.reactor) agentReactorRefs.push(file.rel);
    if ((flags.contextImport || flags.contextApi) && !flags.reactor) {
      agentContextWithoutReactor.push(file.rel);
    }
  }

  const storyImports = await rg(repo, "(@ekairos/story|ekairos/story|from\\s+['\\\"][^'\\\"]*story[^'\\\"]*['\\\"])");
  const contextImports = await rg(repo, "(@ekairos/events|ekairos/context)");
  const oldApis = await rg(repo, "\\b(createStory|storyRunner|Agent\\s*\\(|engine\\s*\\()");
  const legacyModelRefs = await rg(
    repo,
    "\\b(context_contexts|context_events|story_executions|story_steps|story_parts)\\b",
  );
  const contextModelRefs = await rg(
    repo,
    "\\b(context_contexts|context_contexts|context_items|context_executions|context_steps|context_parts)\\b",
  );

  const readiness = {
    endpointStoryFree: endpointStoryRefs.length === 0,
    agentStoryFree: agentStoryRefs.length === 0,
    endpointContextEvidencePresent: endpointContextRefs.length > 0 || endpointReactorRefs.length > 0,
    agentContextEvidencePresent: agentContextRefs.length > 0,
    agentReactorEvidencePresent: agentReactorRefs.length > 0,
    targetAgentEndpointsReady: endpointMissingContextEvidence.length === 0,
    legacyModelMigrated: legacyModelRefs.length === 0,
    contextModelEvidencePresent: contextModelRefs.length > 0,
  };
  readiness.overall = Boolean(
    readiness.endpointStoryFree &&
      readiness.agentStoryFree &&
      readiness.endpointContextEvidencePresent &&
      readiness.agentContextEvidencePresent &&
      readiness.agentReactorEvidencePresent &&
      readiness.targetAgentEndpointsReady &&
      readiness.legacyModelMigrated &&
      readiness.contextModelEvidencePresent,
  );

  const report = {
    createdAt: new Date().toISOString(),
    repo: path.resolve(repo),
    notes: {
      purpose: "Migration readiness for context+reactor on endpoint and agent surfaces.",
      scope: "Static scan only. It does not execute routes or stream tests.",
    },
    counts: {
      storyImports: storyImports.length,
      contextImports: contextImports.length,
      oldApis: oldApis.length,
      legacyModelRefs: legacyModelRefs.length,
      contextModelRefs: contextModelRefs.length,
      endpointFiles: endpointFiles.length,
      agentFiles: agentFiles.length,
      targetAgentEndpoints: targetAgentEndpoints.length,
      endpointStoryRefs: endpointStoryRefs.length,
      agentStoryRefs: agentStoryRefs.length,
      endpointContextRefs: endpointContextRefs.length,
      endpointReactorRefs: endpointReactorRefs.length,
      agentContextRefs: agentContextRefs.length,
      agentReactorRefs: agentReactorRefs.length,
      endpointMissingContextEvidence: endpointMissingContextEvidence.length,
      agentContextWithoutReactor: agentContextWithoutReactor.length,
    },
    readiness,
    findings: {
      storyImports,
      contextImports,
      oldApis,
      legacyModelRefs,
      contextModelRefs,
      endpointStoryRefs,
      endpointContextRefs,
      endpointReactorRefs,
      endpointMissingContextEvidence,
      agentStoryRefs,
      agentContextRefs,
      agentReactorRefs,
      agentContextWithoutReactor,
    },
  };

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`Preflight report written: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
