import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Sólo protegemos las rutas API internas; las páginas /registry manejarán los errores y redirecciones en el cliente.
const isProtectedRoute = createRouteMatcher(["/api/internal/(.*)"]);

// Rutas de webhook que deben quedar abiertas
const isWebhookRoute = createRouteMatcher([
  "/api/internal/registry/webhook",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isWebhookRoute(req)) {
    return NextResponse.next();
  }

  if (isProtectedRoute(req)) {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json({ error: "organization_required" }, { status: 403 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};


