import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const componentsDir = join(root, "components", "ai-elements");
const docsDir = join(root, "content", "components");

function stripExt(name) {
  return name.replace(/\.[^.]+$/i, "");
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs)));
    } else {
      out.push(abs);
    }
  }
  return out;
}

async function main() {
  const [componentFiles, docsFiles] = await Promise.all([
    walk(componentsDir),
    walk(docsDir),
  ]);

  const componentNames = new Set(
    componentFiles
      .filter((p) => p.endsWith(".tsx"))
      .map((p) => stripExt(p.split(/[/\\]/).pop() ?? "")),
  );

  const docNames = new Set(
    docsFiles
      .filter((p) => p.endsWith(".mdx"))
      .map((p) => stripExt(p.split(/[/\\]/).pop() ?? ""))
      .filter(Boolean),
  );

  const missingDocs = [...componentNames].filter((name) => !docNames.has(name));
  const missingComponents = [...docNames].filter(
    (name) => !componentNames.has(name),
  );

  console.log(`components: ${componentNames.size}`);
  console.log(`docs: ${docNames.size}`);

  if (missingDocs.length > 0) {
    console.error(`Missing docs for components: ${missingDocs.join(", ")}`);
  }
  if (missingComponents.length > 0) {
    console.error(
      `Missing components for docs pages: ${missingComponents.join(", ")}`,
    );
  }

  if (missingDocs.length > 0 || missingComponents.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("OK: docs/components parity verified.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
