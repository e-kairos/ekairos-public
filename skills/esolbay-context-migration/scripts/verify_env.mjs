#!/usr/bin/env node
import { loadEnvFiles } from "./_env.mjs";

const envLoad = loadEnvFiles();

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text.length > 0) return text;
  }
  return "";
}

function main() {
  const clerkSecret = firstNonEmpty([process.env.CLERK_SECRET_KEY]);

  const missing = [];
  if (!clerkSecret) missing.push("CLERK_SECRET_KEY");

  if (missing.length > 0) {
    console.error("Missing required env vars:");
    for (const key of missing) console.error(`- ${key}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        required: ["CLERK_SECRET_KEY"],
        envFilesLoaded: envLoad.loaded,
        envFilesFailed: envLoad.failed,
        envAliasesApplied: envLoad.aliases,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main();
