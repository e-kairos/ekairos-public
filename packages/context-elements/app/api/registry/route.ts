import { NextRequest } from "next/server";
import { GET as getComponent } from "@/app/api/registry/[component]/route";

export async function GET(req: NextRequest) {
  return getComponent(req, {
    params: Promise.resolve({ component: "registry.json" }),
  });
}
