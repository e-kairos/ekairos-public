import {
  handleCodexShowcaseRunRequest,
} from "@/lib/examples/reactors/codex/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return await handleCodexShowcaseRunRequest(request);
}
