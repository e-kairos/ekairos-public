import { NextRequest, NextResponse } from "next/server";
import { getOrgAdminDb } from "@/lib/admin-org-db";
import { RegistryService } from "@/lib/domain/registry/service";

// This webhook should be configured in the GitHub App or Repository settings
// It receives push events and triggers a sync.
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const event = req.headers.get("x-github-event");

    if (event === "push") {
      const repoUrl = payload.repository.html_url; // or clone_url
      // We need to identify which Clerk Org this repo belongs to.
      // This mapping (Repo URL -> Org ID) should be stored in DB or passed in webhook URL as query param?
      // Best practice: Webhook URL includes orgId: /api/internal/registry/webhook?orgId=...
      
      const { searchParams } = new URL(req.url);
      const orgId = searchParams.get("orgId");

      if (!orgId) {
          console.error("Webhook missing orgId param");
          return NextResponse.json({ error: "Missing orgId" }, { status: 400 });
      }

      const db = await getOrgAdminDb(orgId);
      
      // Find repo entity
      const repoQuery = await db.query({
          registry_repositories: {
              $: { where: { url: repoUrl } }
          }
      });
      
      const repo = repoQuery.registry_repositories[0];
      if (!repo) {
          console.log(`Repo ${repoUrl} not registered in registry.`);
          return NextResponse.json({ message: "Repo not tracked" }, { status: 200 });
      }

      const service = new RegistryService(db);
      
      // Trigger Sync (Async? Vercel limits execution time. Ideally background job.)
      // For now, await it.
      await service.syncFromGit({
          clerkOrgId: orgId,
          repoId: repo.id
      });

      return NextResponse.json({ message: "Sync triggered" }, { status: 200 });
    }

    return NextResponse.json({ message: "Ignored event" }, { status: 200 });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}













