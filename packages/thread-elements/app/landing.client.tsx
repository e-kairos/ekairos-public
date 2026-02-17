"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ComponentCatalogEntry } from "@/lib/registry-data";

const categoryOrder = ["chatbot", "code", "workflow", "voice", "utilities"];

const categoryMeta: Record<
  string,
  { title: string; description: string; showcase: string[] }
> = {
  chatbot: {
    title: "Chatbot Surfaces",
    description:
      "Conversational primitives adapted to persisted thread events and context hydration.",
    showcase: ["conversation", "message", "prompt-input", "tool"],
  },
  code: {
    title: "IDE Surfaces",
    description:
      "Code execution and inspection UI for coding agents with stable event ordering.",
    showcase: ["agent", "file-tree", "code-block", "terminal", "test-results"],
  },
  workflow: {
    title: "Workflow Surfaces",
    description:
      "Visual and operational components for step execution, orchestration, and control.",
    showcase: ["canvas", "node", "edge", "controls", "panel"],
  },
  voice: {
    title: "Voice Surfaces",
    description:
      "Audio input/output primitives that map voice interactions to thread items and parts.",
    showcase: ["speech-input", "audio-player", "transcription", "voice-selector"],
  },
  utilities: {
    title: "Utilities",
    description:
      "Supporting components for rich answers, citations, media and navigation affordances.",
    showcase: ["image", "inline-citation", "sources", "open-in-chat"],
  },
};

type LandingClientProps = {
  catalog: ComponentCatalogEntry[];
};

function groupByCategory(rows: ComponentCatalogEntry[]) {
  const groups = new Map<string, ComponentCatalogEntry[]>();
  for (const row of rows) {
    const key = row.category || "general";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

export function LandingClient(props: LandingClientProps) {
  const [previewText, setPreviewText] = useState("Thread preview running with persisted events.");
  const [previewState, setPreviewState] = useState<"open" | "streaming" | "closed">("streaming");
  const [previewDensity, setPreviewDensity] = useState<"compact" | "comfortable">("comfortable");

  const grouped = useMemo(() => groupByCategory(props.catalog), [props.catalog]);

  return (
    <div className="container">
      <header className="card hero">
        <div className="pill-row">
          <span className="pill">Registry</span>
          <span className="pill">Thread + Domain + InstantDB</span>
          <span className="pill">{props.catalog.length} elements</span>
        </div>

        <h1 className="hero-title">Ekairos Thread Elements Registry</h1>
        <p className="hero-subtitle">
          Landing and docs for a Thread-first component catalog inspired by AI Elements.
          Every component exposes configurable preview parameters and links to live docs.
        </p>

        <div className="btn-row">
          <Link className="btn primary" href="/docs">
            Open Documentation
          </Link>
          <Link className="btn" href="/api/registry/registry.json">
            Registry JSON
          </Link>
          <Link className="btn" href="/api/registry/all.json">
            Install All JSON
          </Link>
        </div>

        <div className="cmd-grid">
          <pre className="cmd">
{`npx shadcn@latest add http://localhost:3040/api/registry/all.json`}
          </pre>
          <pre className="cmd">
{`npx shadcn@latest add http://localhost:3040/api/registry/conversation.json`}
          </pre>
        </div>
      </header>

      <section className="card section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Landing Preview Controls</h2>
            <p className="section-desc">
              Global parameters applied to every component card preview. Open each docs page for
              live thread-backed preview with real data.
            </p>
          </div>
          <span className="pill">interactive</span>
        </div>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span className="section-desc">preview text</span>
            <input
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              style={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-muted)",
                color: "var(--fg)",
                padding: "8px 10px",
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="section-desc">thread state</span>
            <select
              value={previewState}
              onChange={(event) =>
                setPreviewState(event.target.value as "open" | "streaming" | "closed")
              }
              style={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-muted)",
                color: "var(--fg)",
                padding: "8px 10px",
              }}
            >
              <option value="open">open</option>
              <option value="streaming">streaming</option>
              <option value="closed">closed</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="section-desc">density</span>
            <select
              value={previewDensity}
              onChange={(event) =>
                setPreviewDensity(
                  event.target.value === "compact" ? "compact" : "comfortable",
                )
              }
              style={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-muted)",
                color: "var(--fg)",
                padding: "8px 10px",
              }}
            >
              <option value="comfortable">comfortable</option>
              <option value="compact">compact</option>
            </select>
          </label>
        </div>
      </section>

      {categoryOrder.map((category) => {
        const rows = grouped.get(category);
        if (!rows || rows.length === 0) return null;
        const meta = categoryMeta[category] ?? {
          title: category,
          description: "Thread elements section.",
          showcase: rows.map((row) => row.name).slice(0, 4),
        };
        const showcaseSet = new Set(meta.showcase);
        const prioritized = [
          ...rows.filter((row) => showcaseSet.has(row.name)),
          ...rows.filter((row) => !showcaseSet.has(row.name)),
        ];

        return (
          <section key={category} id={category} className="section card">
            <div className="section-head">
              <div>
                <h2 className="section-title">{meta.title}</h2>
                <p className="section-desc">{meta.description}</p>
              </div>
              <span className="pill">{rows.length} components</span>
            </div>

            <div className="showcase-grid">
              {prioritized.map((row) => (
                <Link key={row.name} href={`/docs/${row.name}`} className="element-card">
                  <div className="meta-row">
                    <span>{row.category}</span>
                    <span>{row.name}</span>
                  </div>
                  <h3>{row.title}</h3>
                  <p>{row.description}</p>
                  <div
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: previewDensity === "compact" ? "6px 8px" : "9px 10px",
                      background: "rgba(3,10,18,0.7)",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div className="meta-row">
                      <span>{previewState}</span>
                      <span>preview</span>
                    </div>
                    <p style={{ margin: 0 }}>{previewText}</p>
                  </div>
                  <div className="meta-row">
                    <span>Docs</span>
                    <span>Live Preview</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section id="thread" className="section card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Thread Runtime Integration</h2>
            <p className="section-desc">
              Thread snapshots are persisted in InstantDB and exposed through domain runtime.
              Landing previews are configurable, and docs previews can auto-provision temporary
              runtime data when static credentials are not configured.
            </p>
          </div>
          <span className="pill">Ekairos extension</span>
        </div>
        <div className="showcase-grid">
          <article className="thread-strip">
            <h3>Thread Snapshot API</h3>
            <p>Read persisted thread state from the registry app runtime.</p>
            <pre className="cmd">{`GET /api/thread/<threadKey>?orgId=<orgId>&ensure=1`}</pre>
          </article>
          <article className="thread-strip">
            <h3>React Hook</h3>
            <p>Use a clean hook API shared with the thread package.</p>
            <pre className="cmd">
{`const thread = useThread({
  threadKey: "preview-conversation",
  orgId: "org_preview",
  ensure: true,
  refreshMs: 1200,
});`}
            </pre>
          </article>
          <article className="thread-strip">
            <h3>Temp Runtime</h3>
            <p>
              If no static app credentials exist, runtime can provision a temporary Instant app
              using platform token and serve real preview data.
            </p>
            <pre className="cmd">{`INSTANT_PERSONAL_ACCESS_TOKEN=<token>`}</pre>
          </article>
        </div>
      </section>
    </div>
  );
}

