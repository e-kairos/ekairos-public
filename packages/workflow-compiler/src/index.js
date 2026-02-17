import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir, access, copyFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, relative, resolve, join } from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const pluginPath = require.resolve("@workflow/swc-plugin");

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (entry.isFile() && full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

async function ensureSwcBinding(projectRoot, logger = console) {
  if (process.platform !== "win32" || process.arch !== "x64") return;

  const coreEntry = require.resolve("@swc/core");
  const coreDir = dirname(coreEntry);
  const bindingPath = resolve(coreDir, "swc.win32-x64-msvc.node");

  try {
    await access(bindingPath, fsConstants.F_OK);
    return;
  } catch {
    // continue
  }

  const fallbackCandidates = [
    resolve(projectRoot, "node_modules", "@swc", "core-win32-x64-msvc", "swc.win32-x64-msvc.node"),
  ];

  for (const candidate of fallbackCandidates) {
    try {
      await access(candidate, fsConstants.F_OK);
      await copyFile(candidate, bindingPath);
      return;
    } catch {
      // keep trying
    }
  }

  try {
    const candidate = require.resolve("@swc/core-win32-x64-msvc/swc.win32-x64-msvc.node");
    await copyFile(candidate, bindingPath);
  } catch (err) {
    logger.warn?.("[workflow-compiler] SWC binary missing; compile may fail.", err);
  }
}

async function loadSwc() {
  const swcModule = await import("@swc/core");
  return swcModule.transform ?? swcModule.default?.transform;
}

function toRelativeFilename(projectRoot, filename) {
  const normalizedWorkingDir = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFilepath = filename.replace(/\\/g, "/");
  const lowerWd = normalizedWorkingDir.toLowerCase();
  const lowerPath = normalizedFilepath.toLowerCase();
  let relativeFilename;
  if (lowerPath.startsWith(`${lowerWd}/`)) {
    relativeFilename = normalizedFilepath.substring(normalizedWorkingDir.length + 1);
  } else if (lowerPath === lowerWd) {
    relativeFilename = ".";
  } else {
    relativeFilename = relative(projectRoot, filename).replace(/\\/g, "/");
    if (relativeFilename.startsWith("../")) {
      relativeFilename = relativeFilename
        .split("/")
        .filter((part) => part !== "..")
        .join("/");
    }
  }
  if (relativeFilename.includes(":") || relativeFilename.startsWith("/")) {
    relativeFilename = normalizedFilepath.split("/").pop() || "unknown.ts";
  }
  return relativeFilename;
}

function createWorkflowSwcPlugin(projectRoot, mode) {
  return {
    name: "workflow-swc",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        const transform = await loadSwc();
        if (!transform) {
          throw new Error("SWC transform function unavailable");
        }
        const relativeFilename = toRelativeFilename(projectRoot, args.path);
        const result = await transform(source, {
          filename: relativeFilename,
          jsc: {
            parser: {
              syntax: args.path.endsWith(".ts") || args.path.endsWith(".tsx") ? "typescript" : "ecmascript",
              tsx: args.path.endsWith(".tsx"),
              jsx: args.path.endsWith(".jsx"),
            },
            target: "es2022",
            experimental: {
              plugins: [[pluginPath, { mode }]],
            },
            transform: {
              react: {
                runtime: "preserve",
              },
            },
          },
          minify: false,
          sourceMaps: false,
        });
        return {
          contents: result.code ?? source,
          loader: "js",
        };
      });
    },
  };
}

async function compileFile({
  projectRoot,
  srcDir,
  outDir,
  filename,
  workflowRegex,
  stepRegex,
}) {
  const source = await readFile(filename, "utf8");
  const needsTransform = workflowRegex.test(source) || stepRegex.test(source);
  const relativeFilename = toRelativeFilename(projectRoot, filename);

  let outputCode = source;
  if (needsTransform) {
    const transform = await loadSwc();
    if (!transform) {
      throw new Error("SWC transform function unavailable");
    }
    const result = await transform(source, {
      filename: relativeFilename,
      jsc: {
        parser: { syntax: "typescript" },
        target: "es2022",
        experimental: {
          plugins: [[pluginPath, { mode: "client" }]],
        },
      },
      minify: false,
      sourceMaps: false,
    });
    outputCode = result.code ?? source;
  }

  const relativeFromSrc = relative(srcDir, filename).replace(/\\/g, "/");
  const outFile = resolve(outDir, relativeFromSrc).replace(/\.ts$/, ".js");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, outputCode, "utf8");
}

function createVirtualEntry(files, workingDir) {
  return files
    .map((file) => {
      const normalizedWorkingDir = workingDir.replace(/\\/g, "/");
      const normalizedFile = file.replace(/\\/g, "/");
      let relativePath = relative(normalizedWorkingDir, normalizedFile).replace(/\\/g, "/");
      if (!relativePath.startsWith(".")) {
        relativePath = `./${relativePath}`;
      }
      return `import '${relativePath}';`;
    })
    .join("\n");
}

async function bundleWorkflowFiles({
  projectRoot,
  mode,
  entryFiles,
  outfile,
  banner,
  platform,
  external,
  format,
}) {
  if (!entryFiles.length) return;
  const entry = createVirtualEntry(entryFiles, projectRoot);
  await mkdir(dirname(outfile), { recursive: true });
  await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: projectRoot,
      sourcefile: "virtual-entry.js",
      loader: "js",
    },
    bundle: true,
    absWorkingDir: projectRoot,
    format: format ?? "cjs",
    platform: platform ?? "neutral",
    target: "es2022",
    write: true,
    outfile,
    mainFields: ["module", "main"],
    conditions: ["workflow"],
    banner: banner ? { js: banner } : undefined,
    sourcemap: "inline",
    minify: false,
    keepNames: true,
    plugins: [createWorkflowSwcPlugin(projectRoot, mode)],
    external,
  });
}

export async function compileWorkflowProject({
  projectRoot = process.cwd(),
  srcDir = "src",
  outDir = "dist",
  includeTests = false,
  workflowRegex = /(use workflow)/,
  stepRegex = /(use step)/,
  workflowPlatform,
  stepPlatform,
  workflowExternal,
  stepExternal,
  logger = console,
} = {}) {
  const resolvedRoot = resolve(projectRoot);
  const resolvedSrc = resolve(resolvedRoot, srcDir);
  const resolvedOut = resolve(resolvedRoot, outDir);

  await mkdir(resolvedOut, { recursive: true });
  await ensureSwcBinding(resolvedRoot, logger);

  const files = await listFiles(resolvedSrc);
  const workflowFiles = [];
  const stepFiles = [];
  const testsDirFragment = `${join("src", "tests")}`;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const isTestFile = file.includes(testsDirFragment);
    if (includeTests || !isTestFile) {
      if (workflowRegex.test(source)) {
        workflowFiles.push(file);
      }
      if (stepRegex.test(source)) {
        stepFiles.push(file);
      }
    }
    await compileFile({
      projectRoot: resolvedRoot,
      srcDir: resolvedSrc,
      outDir: resolvedOut,
      filename: file,
      workflowRegex,
      stepRegex,
    });
  }

  const workflowBundlePath = resolve(resolvedOut, "workflow.bundle.js");
  const stepsBundlePath = resolve(resolvedOut, "steps.bundle.js");

  await bundleWorkflowFiles({
    projectRoot: resolvedRoot,
    mode: "workflow",
    entryFiles: workflowFiles,
    outfile: workflowBundlePath,
    banner: "globalThis.__private_workflows = new Map();",
    platform: workflowPlatform ?? "neutral",
    format: "cjs",
    external: workflowExternal,
  });
  await bundleWorkflowFiles({
    projectRoot: resolvedRoot,
    mode: "step",
    entryFiles: stepFiles,
    outfile: stepsBundlePath,
    platform: stepPlatform ?? "node",
    external: stepExternal ?? ["workflow/internal/private"],
    format: (stepPlatform ?? "node") === "node" ? "cjs" : "esm",
  });

  return {
    outDir: resolvedOut,
    workflowBundlePath,
    stepsBundlePath,
    workflowFiles,
    stepFiles,
  };
}

export { bundleWorkflowFiles };
