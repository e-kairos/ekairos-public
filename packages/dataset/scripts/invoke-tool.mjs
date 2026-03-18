#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return String(process.argv[index + 1] ?? "").trim();
}

async function main() {
  const rpcUrl = readArg("--rpc-url");
  const tool = readArg("--tool");
  const inputFile = readArg("--input-file");
  const inputJson = readArg("--input-json");

  if (!rpcUrl) {
    console.error("Missing --rpc-url");
    process.exit(1);
  }
  if (!tool) {
    console.error("Missing --tool");
    process.exit(1);
  }
  if (!inputFile && !inputJson) {
    console.error("Missing --input-file or --input-json");
    process.exit(1);
  }

  const raw = inputJson || (await readFile(inputFile, "utf8"));
  const input = JSON.parse(raw);

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, input }),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(text || `RPC failed (${response.status})`);
    process.exit(1);
  }

  process.stdout.write(text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
