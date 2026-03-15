import {
  handleCodexShowcaseEntitiesRequest,
} from "@/lib/examples/reactors/codex/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return await handleCodexShowcaseEntitiesRequest(request);
}
