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
export declare function parseDomainDoc(markdown: string): ParsedDomainDoc | null;
export type DomainDocFilter = {
    subdomains?: string[];
    entities?: string[];
};
export declare function filterDomainDoc(doc: DomainDoc, filter?: DomainDocFilter): DomainDoc;
export type DomainDocRenderOptions = {
    titlePrefix?: "Domain" | "Subdomain";
    includeSubdomains?: boolean;
    includeEntities?: boolean;
};
export declare function renderDomainDoc(doc: DomainDoc, options?: DomainDocRenderOptions): string;
