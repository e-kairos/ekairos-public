import { id } from "@instantdb/admin";
import { NextResponse } from "next/server";
import appDomain from "@/lib/domain";
import { DEMO_CONTEXT_KEY, DEMO_THREAD_KEY } from "@/lib/demo/constants";
import { resolveDemoTenantCredentials } from "@/lib/demo/tenant.service";
import { resolveRegistryRuntime } from "@/runtime";

type BootstrapTenantBody = {
  appId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BootstrapTenantBody;
    const appId = String(body?.appId ?? "").trim();
    if (!appId) {
      return NextResponse.json(
        { ok: false, error: "appId is required." },
        { status: 400 },
      );
    }

    const credentials = await resolveDemoTenantCredentials({ appId });
    const runtime = await resolveRegistryRuntime(
      {
        instant: {
          appId: credentials.appId,
          adminToken: credentials.adminToken,
        },
      },
      appDomain,
    );

    const before = await runtime.db.query({
      thread_threads: {
        $: { where: { key: DEMO_THREAD_KEY }, limit: 1 },
      },
      thread_contexts: {
        $: { where: { key: DEMO_CONTEXT_KEY }, limit: 1 },
      },
      thread_items: {
        $: { limit: 1 },
      },
    });

    const hasThread = Array.isArray(before.thread_threads) && before.thread_threads.length > 0;
    const hasContext = Array.isArray(before.thread_contexts) && before.thread_contexts.length > 0;
    const existingThread = hasThread ? before.thread_threads[0] : null;
    const existingContext = hasContext ? before.thread_contexts[0] : null;
    const threadId = existingThread?.id ?? id();
    const contextId = existingContext?.id ?? id();

    if (!hasThread || !hasContext) {
      const now = new Date();

      await runtime.db.transact([
        runtime.db.tx.thread_threads[threadId].update({
          createdAt: now,
          updatedAt: now,
          key: DEMO_THREAD_KEY,
          name: "Registry demo thread",
          status: "idle",
        }),
        runtime.db.tx.thread_contexts[contextId]
          .update({
            createdAt: now,
            updatedAt: now,
            key: DEMO_CONTEXT_KEY,
            status: "open",
            content: {
              source: "registry.demo",
            },
          })
          .link({ thread: threadId }),
      ]);
    }

    const after = await runtime.db.query({
      thread_threads: {
        $: { where: { key: DEMO_THREAD_KEY }, limit: 5 },
      },
      thread_contexts: {
        $: { where: { key: DEMO_CONTEXT_KEY }, limit: 5 },
      },
      thread_items: {
        $: {
          where: {
            "context.key": DEMO_CONTEXT_KEY,
          },
          limit: 5,
          order: { createdAt: "desc" },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        appId: credentials.appId,
        title: credentials.title,
        seeded: !hasThread || !hasContext,
        context: {
          threadId: threadId,
          contextId: contextId,
        },
        counts: {
          threads: Array.isArray(after.thread_threads) ? after.thread_threads.length : 0,
          contexts: Array.isArray(after.thread_contexts) ? after.thread_contexts.length : 0,
          items: Array.isArray(after.thread_items) ? after.thread_items.length : 0,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
