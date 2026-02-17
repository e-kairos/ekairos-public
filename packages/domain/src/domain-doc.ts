import { parse as parseYaml } from "yaml";

export type DomainDocEntity = {
  summary?: string;
  notes?: string[];
  fields?: string[];
};

export type DomainDocSubdomain = {
  summary?: string;
  responsibilities?: string[];
  navigation?: string[];
  entities?: Record<string, string | DomainDocEntity>;
  sections?: DomainDocSection[];
};

export type DomainDocSection = {
  title: string;
  content: string;
};

export type DomainDoc = {
  name?: string;
  type?: string;
  focus?: string;
  overview?: string;
  navigation?: string[];
  responsibilities?: string[];
  entities?: Record<string, string | DomainDocEntity>;
  subdomains?: Record<string, DomainDocSubdomain>;
  sections?: DomainDocSection[];
};

export type ParsedDomainDoc = {
  raw: string;
  data: DomainDoc;
  body?: string;
};

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

type MarkdownSection = {
  level: number;
  title: string;
  content: string;
};

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = normalizeMarkdown(markdown).split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    current.content = current.content.trim();
    sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence) {
      const match = line.match(/^(#{1,6})\s+(.+)\s*$/);
      if (match) {
        flush();
        current = {
          level: match[1].length,
          title: match[2].trim(),
          content: "",
        };
        continue;
      }
    }
    if (!current) continue;
    current.content += `${line}\n`;
  }
  flush();
  return sections;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function parseDomainHeading(title: string): { kind: "domain" | "subdomain"; name: string } | null {
  const match = title.match(/^(domain|subdomain)\s*:\s*(.+)$/i);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() as "domain" | "subdomain",
    name: match[2].trim(),
  };
}

function parseMetaLines(content: string): { type?: string; focus?: string; overview?: string } {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const meta: { type?: string; focus?: string } = {};
  const remaining: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(type|focus)\s*:\s*(.+)$/i);
    if (match) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      if (key === "type") meta.type = value;
      if (key === "focus") meta.focus = value;
      continue;
    }
    remaining.push(line);
  }
  return {
    ...meta,
    overview: remaining.length ? remaining.join("\n") : undefined,
  };
}

function parseList(content: string): string[] {
  const lines = content.split("\n");
  const items: string[] = [];
  let current: string | null = null;
  for (const raw of lines) {
    const match = raw.match(/^\s*[-*]\s+(.+)$/);
    if (match) {
      if (current) items.push(current.trim());
      current = match[1].trim();
      continue;
    }
    if (current && raw.trim()) {
      current += ` ${raw.trim()}`;
    }
  }
  if (current) items.push(current.trim());
  return items;
}

function parseEntities(content: string): Record<string, string | DomainDocEntity> | undefined {
  const lines = content.split("\n");
  const entities: Record<string, string | DomainDocEntity> = {};
  let current: DomainDocEntity | null = null;
  let currentName: string | null = null;
  let mode: "fields" | "notes" | null = null;

  const flush = () => {
    if (!currentName || !current) return;
    const hasDetails = (current.fields && current.fields.length > 0) || (current.notes && current.notes.length > 0);
    if (!hasDetails && current.summary) {
      entities[currentName] = current.summary;
    } else {
      entities[currentName] = {
        summary: current.summary,
        fields: current.fields?.length ? current.fields : undefined,
        notes: current.notes?.length ? current.notes : undefined,
      };
    }
  };

  const startEntity = (name: string, summary?: string) => {
    flush();
    currentName = name;
    current = { summary: summary?.trim() || undefined, fields: [], notes: [] };
    mode = null;
  };

  const pushDetail = (text: string) => {
    if (!current) return;
    if (mode === "fields") {
      current.fields?.push(text);
      return;
    }
    if (mode === "notes") {
      current.notes?.push(text);
      return;
    }
    current.notes?.push(text);
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const topLevel = line.match(/^\s*[-*]\s+(.+)$/) && !line.match(/^\s{2,}[-*]\s+/);
    if (topLevel && bullet) {
      const item = bullet[1].trim();
      const parts = item.split(":");
      if (parts.length > 1) {
        const name = parts.shift()?.trim() ?? "";
        const summary = parts.join(":").trim();
        startEntity(name, summary);
      } else {
        startEntity(item.trim(), "");
      }
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const modeMatch = trimmed.match(/^(fields|notes)\s*:\s*(.*)$/i);
    if (modeMatch) {
      mode = modeMatch[1].toLowerCase() as "fields" | "notes";
      const inline = modeMatch[2]?.trim();
      if (inline) {
        const parts = inline.split(",").map((part) => part.trim()).filter(Boolean);
        for (const part of parts) pushDetail(part);
      }
      continue;
    }
    const detailBullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (detailBullet) {
      const detailText = detailBullet[1].trim();
      const bulletMode = detailText.match(/^(fields|notes)\s*:\s*(.*)$/i);
      if (bulletMode) {
        mode = bulletMode[1].toLowerCase() as "fields" | "notes";
        const inline = bulletMode[2]?.trim();
        if (inline) {
          const parts = inline.split(",").map((part) => part.trim()).filter(Boolean);
          for (const part of parts) pushDetail(part);
        }
        continue;
      }
      pushDetail(detailText);
      continue;
    }
    pushDetail(trimmed);
  }

  flush();
  return Object.keys(entities).length ? entities : undefined;
}

function parseSubdomains(
  sections: MarkdownSection[],
  startIndex: number
): Record<string, DomainDocSubdomain> | undefined {
  const subdomains: Record<string, DomainDocSubdomain> = {};
  let i = startIndex + 1;
  while (i < sections.length) {
    const section = sections[i];
    if (section.level <= 2) break;
    if (section.level !== 3) {
      i += 1;
      continue;
    }
    const heading = parseDomainHeading(section.title);
    const name = heading?.name ?? section.title.trim();
    const entry: DomainDocSubdomain = {};
    if (section.content.trim()) {
      entry.summary = section.content.trim();
    }
    const nestedSections: DomainDocSection[] = [];
    let j = i + 1;
    while (j < sections.length) {
      const next = sections[j];
      if (next.level <= 3) break;
      if (next.level === 4) {
        const title = next.title.trim();
        const normalized = normalizeTitle(title);
        if (normalized === "responsibilities") {
          entry.responsibilities = parseList(next.content);
        } else if (normalized === "navigation") {
          entry.navigation = parseList(next.content);
        } else if (normalized === "entities") {
          entry.entities = parseEntities(next.content);
        } else {
          if (next.content.trim()) {
            nestedSections.push({ title, content: next.content.trim() });
          }
        }
      }
      j += 1;
    }
    if (nestedSections.length) entry.sections = nestedSections;
    subdomains[name] = entry;
    i = j;
  }
  return Object.keys(subdomains).length ? subdomains : undefined;
}

function parseMarkdownDomainDoc(markdown: string): ParsedDomainDoc | null {
  const sections = parseMarkdownSections(markdown);
  if (!sections.length) return null;

  const rootHeading = sections.find((section) => section.level === 1);
  if (!rootHeading) return null;

  const headingInfo = parseDomainHeading(rootHeading.title);
  const meta = parseMetaLines(rootHeading.content);
  const doc: DomainDoc = {
    name: headingInfo?.name,
    type: meta.type,
    focus: meta.focus,
  };

  const overviewSection = sections.find(
    (section) => section.level === 2 && normalizeTitle(section.title) === "overview"
  );
  if (overviewSection?.content.trim()) {
    doc.overview = overviewSection.content.trim();
  } else if (meta.overview) {
    doc.overview = meta.overview;
  }

  const responsibilitiesSection = sections.find(
    (section) => section.level === 2 && normalizeTitle(section.title) === "responsibilities"
  );
  if (responsibilitiesSection) {
    doc.responsibilities = parseList(responsibilitiesSection.content);
  }

  const navigationSection = sections.find(
    (section) => section.level === 2 && normalizeTitle(section.title) === "navigation"
  );
  if (navigationSection) {
    doc.navigation = parseList(navigationSection.content);
  }

  const entitiesSection = sections.find(
    (section) => section.level === 2 && normalizeTitle(section.title) === "entities"
  );
  if (entitiesSection) {
    doc.entities = parseEntities(entitiesSection.content);
  }

  const subdomainsSectionIndex = sections.findIndex(
    (section) => section.level === 2 && normalizeTitle(section.title) === "subdomains"
  );
  if (subdomainsSectionIndex >= 0) {
    doc.subdomains = parseSubdomains(sections, subdomainsSectionIndex);
  }

  const reservedTitles = new Set([
    "overview",
    "responsibilities",
    "navigation",
    "entities",
    "subdomains",
  ]);
  const extraSections: DomainDocSection[] = [];
  for (const section of sections) {
    if (section.level !== 2) continue;
    const normalized = normalizeTitle(section.title);
    if (reservedTitles.has(normalized)) continue;
    if (!section.content.trim()) continue;
    extraSections.push({ title: section.title.trim(), content: section.content.trim() });
  }
  if (extraSections.length) {
    doc.sections = extraSections;
  }

  return { raw: markdown, data: doc };
}

function parseYamlDomainDoc(markdown: string): ParsedDomainDoc | null {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return null;
  let data: any = null;
  try {
    data = parseYaml(match[1]);
  } catch {
    return null;
  }
  if (!data) return null;
  const doc = (data.ekairos ?? data) as DomainDoc;
  const body = markdown.slice(match[0].length).trim();
  return {
    raw: markdown,
    data: doc,
    body: body.length ? body : undefined,
  };
}

export function parseDomainDoc(markdown: string): ParsedDomainDoc | null {
  if (!markdown) return null;
  const normalized = markdown.trim();
  if (!normalized) return null;
  const hasMarkdownHeading = /^#\s*(domain|subdomain)\s*:/im.test(normalized);
  if (hasMarkdownHeading) {
    const parsed = parseMarkdownDomainDoc(normalized);
    if (parsed) return parsed;
  }
  return parseYamlDomainDoc(normalized);
}

export type DomainDocFilter = {
  subdomains?: string[];
  entities?: string[];
};

export function filterDomainDoc(doc: DomainDoc, filter?: DomainDocFilter): DomainDoc {
  const subdomains = filter?.subdomains ? new Set(filter.subdomains) : null;
  const entities = filter?.entities ? new Set(filter.entities) : null;

  const next: DomainDoc = { ...doc };

  if (next.subdomains && subdomains) {
    const filtered: Record<string, DomainDocSubdomain> = {};
    for (const [key, value] of Object.entries(next.subdomains)) {
      if (!subdomains.has(key)) continue;
      filtered[key] = value;
    }
    next.subdomains = filtered;
  }

  if (entities) {
    if (next.entities) {
      const filtered: Record<string, string | DomainDocEntity> = {};
      for (const [key, value] of Object.entries(next.entities)) {
        if (!entities.has(key)) continue;
        filtered[key] = value;
      }
      next.entities = filtered;
    }
    if (next.subdomains) {
      for (const subdomain of Object.values(next.subdomains)) {
        if (!subdomain.entities) continue;
        const filtered: Record<string, string | DomainDocEntity> = {};
        for (const [key, value] of Object.entries(subdomain.entities)) {
          if (!entities.has(key)) continue;
          filtered[key] = value;
        }
        subdomain.entities = filtered;
      }
    }
  }

  return next;
}

export type DomainDocRenderOptions = {
  titlePrefix?: "Domain" | "Subdomain";
  includeSubdomains?: boolean;
  includeEntities?: boolean;
};

function pushSection(lines: string[], title: string, content?: string) {
  if (!content) return;
  lines.push("");
  lines.push(`## ${title}`);
  lines.push(content.trim());
}

function pushList(lines: string[], title: string, items?: string[]) {
  if (!items || items.length === 0) return;
  lines.push("");
  lines.push(`## ${title}`);
  for (const item of items) lines.push(`- ${item}`);
}

function renderEntityEntry(
  key: string,
  value: string | DomainDocEntity
): string[] {
  if (typeof value === "string") {
    return [`- ${key}: ${value}`];
  }
  const summary = value.summary?.trim();
  const headline = summary ? `- ${key}: ${summary}` : `- ${key}`;
  const lines: string[] = [headline];
  if (value.fields?.length) {
    lines.push(`  - Fields: ${value.fields.join("; ")}`);
  }
  if (value.notes?.length) {
    lines.push(`  - Notes: ${value.notes.join("; ")}`);
  }
  return lines;
}

function pushEntitiesSection(
  lines: string[],
  heading: string,
  entities?: Record<string, string | DomainDocEntity>,
  includeEntities = true
) {
  if (!includeEntities || !entities || Object.keys(entities).length === 0) return;
  lines.push("");
  lines.push(heading);
  for (const [key, value] of Object.entries(entities)) {
    lines.push(...renderEntityEntry(key, value));
  }
}

function pushSubdomain(
  lines: string[],
  name: string,
  sub: DomainDocSubdomain,
  includeEntities = true
) {
  lines.push("");
  lines.push(`### ${name}`);
  if (sub.summary) lines.push(sub.summary.trim());
  if (sub.responsibilities?.length) {
    lines.push("");
    lines.push("#### Responsibilities");
    for (const item of sub.responsibilities) lines.push(`- ${item}`);
  }
  if (sub.navigation?.length) {
    lines.push("");
    lines.push("#### Navigation");
    for (const item of sub.navigation) lines.push(`- ${item}`);
  }
  if (includeEntities) {
    pushEntitiesSection(lines, "#### Entities", sub.entities, true);
  }
  if (sub.sections?.length) {
    for (const section of sub.sections) {
      lines.push("");
      lines.push(`#### ${section.title}`);
      lines.push(section.content.trim());
    }
  }
}

export function renderDomainDoc(
  doc: DomainDoc,
  options?: DomainDocRenderOptions
): string {
  const prefix = options?.titlePrefix ?? "Domain";
  const includeSubdomains = options?.includeSubdomains !== false;
  const includeEntities = options?.includeEntities !== false;

  const lines: string[] = [];
  const titleName = doc.name ?? "unknown";
  const prefixLabel = prefix === "Subdomain" ? "subdomain" : "domain";
  lines.push(`# ${prefixLabel}: ${titleName}`);
  if (doc.type) lines.push(`Type: ${doc.type}`);
  if (doc.focus) lines.push(`Focus: ${doc.focus}`);

  pushSection(lines, "Overview", doc.overview);
  pushList(lines, "Navigation", doc.navigation);
  pushList(lines, "Responsibilities", doc.responsibilities);
  pushEntitiesSection(lines, "## Entities", doc.entities, includeEntities);

  if (doc.sections?.length) {
    for (const section of doc.sections) {
      pushSection(lines, section.title, section.content);
    }
  }

  if (includeSubdomains && doc.subdomains) {
    lines.push("");
    lines.push("## Subdomains");
    for (const [name, sub] of Object.entries(doc.subdomains)) {
      pushSubdomain(lines, name, sub, includeEntities);
    }
  }

  return lines.join("\n").trim() + "\n";
}
