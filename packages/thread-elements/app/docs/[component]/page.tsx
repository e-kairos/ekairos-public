import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getComponentCatalog,
  getComponentDocs,
  getComponentSources,
} from "@/lib/registry-data";
import { ComponentPreviewClient } from "./component-preview.client";

const categoryOrder = ["chatbot", "code", "workflow", "voice", "utilities"];

function groupByCategory(rows: Awaited<ReturnType<typeof getComponentCatalog>>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.category || "general";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

export default async function ComponentDocPage(props: {
  params: Promise<{ component: string }>;
}) {
  const { component } = await props.params;
  const key = decodeURIComponent(component || "").trim();

  const [catalog, docs, sources] = await Promise.all([
    getComponentCatalog(),
    getComponentDocs(),
    getComponentSources(),
  ]);

  const grouped = groupByCategory(catalog);
  const entry = catalog.find((row) => row.name === key);
  if (!entry) {
    return (
      <div className="container">
        <section className="card doc-panel">
          <h1>Component not found</h1>
          <p className="section-desc">{key}</p>
          <Link className="btn" href="/docs">
            Back to docs
          </Link>
        </section>
      </div>
    );
  }

  const doc = docs.get(key);
  const source = sources.find((row) => row.name === key);
  const installCmd = `npx shadcn@latest add http://localhost:3040/api/registry/${entry.name}.json`;
  const curlCmd = `curl http://localhost:3040/api/registry/${entry.name}.json`;

  return (
    <div className="container docs-shell">
      <aside className="card docs-sidebar">
        <h2>Components</h2>
        <p>
          Select any element to inspect docs, install command and transformed registry source.
        </p>
        <nav className="toc-list">
          <Link className="toc-link" href="/docs">
            All docs
          </Link>
          {categoryOrder.map((category) => {
            const rows = grouped.get(category);
            if (!rows?.length) return null;
            return rows.map((row) => (
              <Link
                key={row.name}
                href={`/docs/${row.name}`}
                className="toc-link"
                style={{
                  borderColor: row.name === entry.name ? "var(--accent-strong)" : undefined,
                  background:
                    row.name === entry.name ? "rgba(55,214,255,0.08)" : undefined,
                }}
              >
                {row.title}
              </Link>
            ));
          })}
        </nav>
      </aside>

      <main className="docs-main">
        <header className="card doc-top">
          <Link className="btn" href="/docs">
            {"<- "}Back to docs
          </Link>
          <h1>{entry.title}</h1>
          <p>{entry.description}</p>
          <div className="pill-row">
            <span className="pill">{entry.category}</span>
            <span className="pill">{entry.name}</span>
          </div>
          <div className="cmd-grid">
            <pre className="cmd">{installCmd}</pre>
            <pre className="cmd">{curlCmd}</pre>
          </div>
        </header>

        <section className="card doc-panel">
          <h2>Thread Usage Snippet</h2>
          <pre>
{`import { useThread } from "@ekairos/thread/react";
import { ${entry.title.replace(/\s+/g, "")} } from "@/components/ai-elements/${entry.name}";

const state = useThread({
  threadKey: "thread-demo",
  orgId: "org_local",
  ensure: true,
  refreshMs: 1200,
});`}
          </pre>
        </section>

        <ComponentPreviewClient
          componentName={entry.name}
          componentCategory={entry.category}
          componentTitle={entry.title}
        />

        {doc ? (
          <section className="card doc-panel">
            <h2>Reference</h2>
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
            </div>
          </section>
        ) : null}

        {source ? (
          <section className="card doc-panel">
            <h2>Registry Source</h2>
            <pre>{source.content}</pre>
          </section>
        ) : null}
      </main>
    </div>
  );
}
