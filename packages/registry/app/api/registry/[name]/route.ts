import { NextRequest, NextResponse } from "next/server";
import { getOrgAdminDb } from "@/lib/admin-org-db";

// NOTE: This endpoint is public (or protected via token) to serve registry items
// like shadcn CLI does: GET /registry/[name].json
// Since it's dynamic, we need to know WHICH organization's registry to serve.
// Usually this is part of the URL domain (e.g. org.ekairos.dev/registry/button.json)
// or passed as a header/query param.
// Assuming for now we get orgId from header or default.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params; // e.g. "button" or "button.json"
  const componentName = name.replace(".json", "");

  // TODO: Determine Org ID securely. For now, taking from header or env?
  // If this is a public registry for the Org, maybe we use a publishable key?
  // Let's assume a header "x-registry-org-id" for now or similar mechanism.
  const orgId = req.headers.get("x-registry-org-id");

  if (!orgId) {
     return NextResponse.json({ error: "Organization ID required" }, { status: 400 });
  }

  try {
    const db = await getOrgAdminDb(orgId);
    
    // Query Component
    const query = await db.query({
      registry_components: {
        $: { where: { name: componentName } },
        dependencies: {}, // External packages
        registryDependencies: {}, // Internal components
        files: {
            storage: {}, // Link to $files
        }, 
      },
    });

    const component = query.registry_components[0];

    if (!component) {
      return NextResponse.json({ error: "Component not found" }, { status: 404 });
    }

    // Transform to shadcn registry format
    const response = {
      name: component.name,
      type: component.type,
      title: component.title,
      description: component.description,
      version: component.version,
      dependencies: component.dependencies.map((d: any) => d.name), // shadcn expects string[]
      registryDependencies: component.registryDependencies.map((d: any) => d.name), // shadcn expects string[]
      files: component.files.map((f: any) => ({
        path: f.path,
        content: "", // TODO: Fetch content from f.storage.url if available
        type: f.type,
        target: f.target,
      })),
      meta: component.meta,
      cssVars: component.cssVars,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}













