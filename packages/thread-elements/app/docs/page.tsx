import Link from "next/link";
import { getComponentCatalog } from "@/lib/registry-data";

const categoryOrder = ["chatbot", "code", "workflow", "voice", "utilities"];

const categoryLabel: Record<string, string> = {
  chatbot: "Chatbot",
  code: "IDE",
  workflow: "Workflow",
  voice: "Voice",
  utilities: "Utilities",
};

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

export default async function DocsIndexPage() {
  const catalog = await getComponentCatalog();
  const grouped = groupByCategory(catalog);

  return (
    <div className="container docs-shell">
      <aside className="card docs-sidebar">
        <h2>Thread Elements Docs</h2>
        <p>
          Every element is installable through shadcn registry JSON and documented
          for Thread + Domain integration.
        </p>
        <nav className="toc-list">
          <Link className="toc-link" href="/">
            Registry Landing
          </Link>
          {categoryOrder.map((key) => {
            const count = grouped.get(key)?.length ?? 0;
            return (
              <a key={key} className="toc-link" href={`#${key}`}>
                {categoryLabel[key] ?? key} ({count})
              </a>
            );
          })}
          <a className="toc-link" href="#thread-integration">
            Thread Integration
          </a>
        </nav>
      </aside>

      <main className="docs-main">
        <header className="card doc-top">
          <h1>Documentation</h1>
          <p>
            Catalog aligned with AI Elements and adapted for Ekairos Thread.
            Use this page as the entry point for installation, usage, and per-element
            reference docs.
          </p>
          <div className="cmd-grid">
            <pre className="cmd">
{`npx shadcn@latest add http://localhost:3040/api/registry/all.json`}
            </pre>
            <pre className="cmd">
{`curl http://localhost:3040/api/registry/registry.json`}
            </pre>
          </div>
        </header>

        {categoryOrder.map((category) => {
          const rows = grouped.get(category);
          if (!rows || rows.length === 0) return null;
          return (
            <section key={category} id={category} className="card section">
              <div className="section-head">
                <h2 className="section-title">{categoryLabel[category] ?? category}</h2>
                <span className="pill">{rows.length} components</span>
              </div>
              <div className="docs-cards">
                {rows.map((row) => (
                  <Link key={row.name} href={`/docs/${row.name}`} className="element-card">
                    <div className="meta-row">
                      <span>{row.category}</span>
                      <span>{row.name}</span>
                    </div>
                    <h3>{row.title}</h3>
                    <p>{row.description}</p>
                    <div className="meta-row">
                      <span>Install</span>
                      <span>Reference</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <section id="thread-integration" className="card section">
          <div className="section-head">
            <h2 className="section-title">Thread Integration</h2>
            <span className="pill">Ekairos</span>
          </div>
          <p className="section-desc">
            The component catalog ships with a thread snapshot API and the `useThread`
            client hook so UI can hydrate from persisted state and stay synced while streams run.
          </p>
          <pre className="cmd">
{`import { useThread } from "@ekairos/thread/react";

const { data, isLoading, error, refresh } = useThread({
  threadKey: "thread-support-001",
  orgId: "org_local",
  ensure: true,
  refreshMs: 1500,
});`}
          </pre>
        </section>
      </main>
    </div>
  );
}
