import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const DEFAULT_ENV_BASENAMES = [
  ".env.local",
  ".env.production.local",
  ".env.production",
  ".env",
];

const ENV_ALIASES = {};

function normalizePath(value) {
  return path.resolve(String(value).trim());
}

function parseCliEnvFiles(argv) {
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--env-file") continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      files.push(next);
      i += 1;
    }
  }
  return files;
}

function walkAncestors(startDir, maxDepth = 6) {
  const dirs = [];
  let current = normalizePath(startDir);
  for (let i = 0; i < maxDepth; i += 1) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function inferWorkspaceRoot(ancestorDirs) {
  for (const dir of ancestorDirs) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
  }
  return null;
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const resolved = normalizePath(value);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function discoverCandidateFiles(options = {}) {
  const cwd = normalizePath(options.cwd || process.cwd());
  const ancestors = walkAncestors(cwd);
  const workspaceRoot = inferWorkspaceRoot(ancestors);
  const explicit = [
    ...parseCliEnvFiles(process.argv.slice(2)),
    ...(options.envFiles || []),
    ...(options.envFile ? [options.envFile] : []),
  ];

  const defaults = [];
  for (const dir of ancestors) {
    for (const basename of DEFAULT_ENV_BASENAMES) {
      defaults.push(path.join(dir, basename));
    }
  }

  if (workspaceRoot) {
    const siblingRoots = [
      path.resolve(workspaceRoot, "../ekairos-core"),
      path.resolve(workspaceRoot, "../esolbay-platform"),
    ];
    for (const dir of siblingRoots) {
      for (const basename of DEFAULT_ENV_BASENAMES) {
        defaults.push(path.join(dir, basename));
      }
    }
  }

  return unique([...explicit, ...defaults]).filter((file) => fs.existsSync(file));
}

function applyAliases() {
  const applied = [];
  for (const [target, candidates] of Object.entries(ENV_ALIASES)) {
    const existing = process.env[target];
    if (existing && String(existing).trim()) continue;
    for (const source of candidates) {
      const value = process.env[source];
      if (!value || !String(value).trim()) continue;
      process.env[target] = String(value);
      applied.push({ target, source });
      break;
    }
  }
  return applied;
}

export function loadEnvFiles(options = {}) {
  const loaded = [];
  const failed = [];
  const files = discoverCandidateFiles(options);

  for (const file of files) {
    const result = dotenv.config({
      path: file,
      override: false,
      quiet: true,
    });
    if (result.error) {
      failed.push({
        file,
        error: result.error.message,
      });
      continue;
    }
    loaded.push(file);
  }

  const shouldLog = options.log ?? process.argv.includes("--log-env");
  const aliases = applyAliases();
  if (shouldLog) {
    for (const file of loaded) {
      console.error(`[env] loaded ${file}`);
    }
    for (const item of failed) {
      console.error(`[env] failed ${item.file}: ${item.error}`);
    }
    for (const item of aliases) {
      console.error(`[env] alias ${item.target} <= ${item.source}`);
    }
  }

  return { loaded, failed, aliases };
}
