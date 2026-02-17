"use client";

import { useMemo, useState } from "react";
import type { Edge as FlowEdge, Node as FlowNode, NodeProps } from "@xyflow/react";

import { useThread } from "@ekairos/thread/react";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ai-elements/file-tree";
import { Terminal } from "@/components/ai-elements/terminal";
import {
  Test,
  TestResults,
  TestResultsContent,
  TestSuite,
  TestSuiteContent,
  TestSuiteName,
} from "@/components/ai-elements/test-results";
import { Canvas } from "@/components/ai-elements/canvas";
import {
  Node,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";
import { Edge } from "@/components/ai-elements/edge";
import { Controls } from "@/components/ai-elements/controls";
import { Panel } from "@/components/ai-elements/panel";

type ComponentPreviewClientProps = {
  componentName: string;
  componentCategory: string;
  componentTitle: string;
};

type ThreadItem = Record<string, unknown>;
type ThreadPart = Record<string, unknown>;

type PreviewMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  textParts: string[];
  toolParts: ThreadPart[];
};

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type WorkflowNodeData = {
  title: string;
  description: string;
  status: string;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getParts(item: ThreadItem): ThreadPart[] {
  const content = asObject(item.content);
  const parts = asArray(content?.parts);
  return parts
    .map((entry) => asObject(entry))
    .filter((entry): entry is ThreadPart => Boolean(entry));
}

function toPreviewMessages(items: ThreadItem[]): PreviewMessage[] {
  return items.map((item) => {
    const id = asString(item.id, makeId());
    const type = asString(item.type, "output_text");
    const createdAt = asString(item.createdAt, new Date().toISOString());
    const parts = getParts(item);
    const textParts: string[] = [];
    const toolParts: ThreadPart[] = [];

    for (const part of parts) {
      const partType = asString(part.type);
      if (partType === "text" && typeof part.text === "string") {
        textParts.push(part.text);
        continue;
      }
      if (partType === "tool-call") {
        toolParts.push(part);
      }
    }

    const role: "user" | "assistant" = type.startsWith("input_") ? "user" : "assistant";
    if (textParts.length === 0 && toolParts.length === 0) {
      textParts.push(JSON.stringify(item));
    }

    return { id, role, createdAt, textParts, toolParts };
  });
}

function ThreadNodeCard({ data }: NodeProps<FlowNode<WorkflowNodeData>>) {
  return (
    <Node handles={{ source: true, target: true }}>
      <NodeHeader>
        <NodeTitle>{data.title}</NodeTitle>
        <NodeDescription>{data.status}</NodeDescription>
      </NodeHeader>
      <NodeContent>{data.description}</NodeContent>
    </Node>
  );
}

function ChatbotPreview({
  messages,
  accent,
  showJson,
}: {
  messages: PreviewMessage[];
  accent: string;
  showJson: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        className="card"
        style={{ border: `1px solid ${accent}44`, padding: 12, display: "grid", gap: 10, maxHeight: 420, overflow: "auto" }}
      >
          {messages.map((message) => (
            <article
              key={message.id}
              style={{
                marginLeft: message.role === "user" ? "auto" : undefined,
                maxWidth: "92%",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 10,
                background:
                  message.role === "user" ? "rgba(55,214,255,0.12)" : "rgba(255,255,255,0.03)",
              }}
            >
              <div className="meta-row" style={{ marginBottom: 8 }}>
                <span>{message.role}</span>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                {message.textParts.join("\n\n")}
              </p>
              {message.toolParts.map((part, index) => {
                const toolName = asString(part.toolName, "tool");
                return (
                  <div
                    key={`${message.id}:tool:${index}`}
                    style={{
                      marginTop: 8,
                      border: "1px dashed var(--line)",
                      borderRadius: 8,
                      padding: 8,
                    }}
                  >
                    <div className="meta-row">
                      <span>tool-call</span>
                      <span>{toolName}</span>
                    </div>
                    <pre className="cmd" style={{ marginTop: 6 }}>
                      {JSON.stringify(asObject(part.input) ?? {}, null, 2)}
                    </pre>
                  </div>
                );
              })}
              {showJson ? (
                <pre className="cmd" style={{ marginTop: 8 }}>
                  {JSON.stringify(message, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
      </div>
    </div>
  );
}

function IdePreview({
  messages,
  accent,
  density,
}: {
  messages: PreviewMessage[];
  accent: string;
  density: "compact" | "comfortable";
}) {
  const [selectedPath, setSelectedPath] = useState<string>("src/thread.ts");
  const terminalOutput = messages
    .map((message) => `[${message.role}] ${message.textParts.join(" ").slice(0, 120)}`)
    .join("\n");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "minmax(220px,320px) minmax(0,1fr)",
        }}
      >
        <FileTree
          className="card"
          defaultExpanded={new Set<string>(["src", "src/components"])}
          onSelect={setSelectedPath}
          selectedPath={selectedPath}
          style={{ border: `1px solid ${accent}44`, padding: density === "compact" ? 8 : 12 }}
        >
          <FileTreeFolder name="src" path="src">
            <FileTreeFile name="thread.ts" path="src/thread.ts" />
            <FileTreeFolder name="components" path="src/components">
              <FileTreeFile name="Agent.tsx" path="src/components/Agent.tsx" />
              <FileTreeFile name="Sidebar.tsx" path="src/components/Sidebar.tsx" />
            </FileTreeFolder>
          </FileTreeFolder>
          <FileTreeFile name="README.md" path="README.md" />
        </FileTree>

        <Terminal
          className="card"
          isStreaming
          output={terminalOutput || "No terminal output yet."}
          style={{ border: `1px solid ${accent}44` }}
        />
      </div>

      <TestResults
        className="card"
        style={{ border: `1px solid ${accent}44` }}
        summary={{
          total: 3,
          passed: 2,
          failed: 0,
          skipped: 1,
          duration: 1240,
        }}
      >
        <TestResultsContent>
          <TestSuite defaultOpen name="thread integration" status="passed">
            <TestSuiteName />
            <TestSuiteContent>
              <Test duration={412} name="loads snapshot from /api/thread" status="passed" />
              <Test duration={380} name="renders items in createdAt order" status="passed" />
              <Test duration={0} name="supports streaming deltas" status="skipped" />
            </TestSuiteContent>
          </TestSuite>
        </TestResultsContent>
      </TestResults>
    </div>
  );
}

function WorkflowPreview({
  messages,
  accent,
}: {
  messages: PreviewMessage[];
  accent: string;
}) {
  const nodeTypes = useMemo(() => ({ threadNode: ThreadNodeCard }), []);
  const edgeTypes = useMemo(() => ({ animated: Edge.Animated }), []);

  const nodes = useMemo<Array<FlowNode<WorkflowNodeData>>>(
    () => [
      {
        id: "trigger",
        type: "threadNode",
        position: { x: 0, y: 80 },
        data: {
          title: "Trigger",
          description: messages[0]?.textParts[0] ?? "Input event",
          status: "completed",
        },
      },
      {
        id: "reaction",
        type: "threadNode",
        position: { x: 380, y: 80 },
        data: {
          title: "Reaction",
          description: messages.at(-1)?.textParts.join(" ") ?? "Assistant response",
          status: "streaming",
        },
      },
    ],
    [messages],
  );

  const edges = useMemo<Array<FlowEdge>>(
    () => [
      {
        id: "trigger->reaction",
        source: "trigger",
        target: "reaction",
        type: "animated",
      },
    ],
    [],
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        className="card"
        style={{
          border: `1px solid ${accent}44`,
          borderRadius: 12,
          height: 360,
          overflow: "hidden",
        }}
      >
        <Canvas edgeTypes={edgeTypes} nodeTypes={nodeTypes} nodes={nodes} edges={edges}>
          <Controls />
          <Panel position="top-right">
            <div className="pill">workflow: streaming</div>
          </Panel>
        </Canvas>
      </div>
    </div>
  );
}

function EventList({
  items,
  showJson,
  accent,
  density,
}: {
  items: ThreadItem[];
  showJson: boolean;
  accent: string;
  density: "compact" | "comfortable";
}) {
  return (
    <div
      style={{
        border: `1px solid ${accent}55`,
        borderRadius: 12,
        padding: density === "compact" ? 10 : 14,
        display: "grid",
        gap: density === "compact" ? 8 : 12,
        background: "rgba(7,16,28,0.55)",
      }}
    >
      {items.map((item) => {
        const itemId = asString(item.id, makeId());
        const createdAt = asString(item.createdAt);
        const type = asString(item.type, "event");
        const parts = getParts(item);
        const summary =
          parts
            .map((part) => (part.type === "text" ? asString(part.text) : asString(part.type)))
            .filter(Boolean)
            .join(" | ")
            .slice(0, 180) || JSON.stringify(item).slice(0, 180);

        return (
          <article
            className="element-card"
            key={`${itemId}:${createdAt}`}
            style={{
              background: "rgba(8,13,24,0.92)",
              borderColor: `${accent}40`,
              padding: density === "compact" ? 10 : 13,
            }}
          >
            <div className="meta-row">
              <span>{type}</span>
              <span>{createdAt ? new Date(createdAt).toLocaleTimeString() : "-"}</span>
            </div>
            <h3 style={{ margin: 0, fontSize: density === "compact" ? 14 : 15 }}>{summary}</h3>
            {showJson ? (
              <pre className="cmd" style={{ marginTop: 6 }}>
                {JSON.stringify(item, null, 2)}
              </pre>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function ComponentPreviewClient(props: ComponentPreviewClientProps) {
  const [threadKey, setThreadKey] = useState(`preview-${props.componentName}`);
  const [orgId, setOrgId] = useState("org_preview");
  const [refreshMs, setRefreshMs] = useState(1500);
  const [maxItems, setMaxItems] = useState(8);
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [showJson, setShowJson] = useState(false);
  const [accent, setAccent] = useState("#37d6ff");

  const thread = useThread({
    threadKey,
    orgId,
    refreshMs,
    ensure: true,
    endpoint: "/api/thread",
  });

  const items = useMemo(() => {
    const rows = Array.isArray(thread.data?.items)
      ? (thread.data?.items as Array<Record<string, unknown>>)
      : [];
    return rows.slice(-Math.max(1, maxItems));
  }, [thread.data?.items, maxItems]);

  const messages = useMemo(() => toPreviewMessages(items), [items]);

  const previewBody = useMemo(() => {
    if (props.componentCategory === "chatbot") {
      return <ChatbotPreview accent={accent} messages={messages} showJson={showJson} />;
    }
    if (props.componentCategory === "code") {
      return <IdePreview accent={accent} density={density} messages={messages} />;
    }
    if (props.componentCategory === "workflow") {
      return <WorkflowPreview accent={accent} messages={messages} />;
    }
    return (
      <EventList accent={accent} density={density} items={items} showJson={showJson} />
    );
  }, [accent, density, items, messages, props.componentCategory, showJson]);

  return (
    <section className="card doc-panel">
      <h2 style={{ marginBottom: 12 }}>Live Preview Playground</h2>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          marginBottom: 12,
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <span className="section-desc">threadKey</span>
          <input
            value={threadKey}
            onChange={(event) => setThreadKey(event.target.value)}
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
          <span className="section-desc">orgId</span>
          <input
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
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
          <span className="section-desc">refreshMs</span>
          <input
            type="number"
            min={250}
            max={5000}
            step={50}
            value={refreshMs}
            onChange={(event) => setRefreshMs(Number(event.target.value || 0))}
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
          <span className="section-desc">maxItems</span>
          <input
            type="number"
            min={1}
            max={20}
            value={maxItems}
            onChange={(event) => setMaxItems(Number(event.target.value || 1))}
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
          <span className="section-desc">density</span>
          <select
            value={density}
            onChange={(event) =>
              setDensity(event.target.value === "compact" ? "compact" : "comfortable")
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

        <label style={{ display: "grid", gap: 6 }}>
          <span className="section-desc">accent</span>
          <input
            type="color"
            value={accent}
            onChange={(event) => setAccent(event.target.value)}
            style={{ borderRadius: 8, border: "1px solid var(--line)", minHeight: 38 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          className="btn"
          type="button"
          onClick={() => void thread.refresh()}
          style={{ cursor: "pointer" }}
        >
          Refresh
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => setShowJson((prev) => !prev)}
          style={{ cursor: "pointer" }}
        >
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
        <span className="pill">{props.componentCategory}</span>
        <span className="pill">{thread.data?.thread?.status ?? "unknown"}</span>
        <span className="pill">{thread.error ? "error" : "ready"}</span>
      </div>

      <div data-ek-thread-element-preview={props.componentName}>
        {thread.error ? (
          <div className="thread-strip">
            <h3>Preview Error</h3>
            <p>{thread.error}</p>
          </div>
        ) : null}

        {thread.isLoading && !thread.data ? (
          <div className="thread-strip">
            <h3>Loading</h3>
            <p>Fetching thread snapshot and preparing preview dataset.</p>
          </div>
        ) : null}

        {previewBody}
      </div>
    </section>
  );
}
