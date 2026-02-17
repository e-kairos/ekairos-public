export type EkairosDomainSource = {
    toInstantSchema?: () => any;
    schema?: () => any;
    entities?: Record<string, unknown>;
    links?: Record<string, unknown>;
    rooms?: Record<string, unknown>;
    context?: (options?: any) => any;
    contextString?: (options?: any) => string;
};
export type EkairosDomainEntry = {
    name: string;
    source?: EkairosDomainSource;
    actions?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};
export type EkairosDomainConfig = {
    domain?: EkairosDomainSource;
    actions?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    mcp?: EkairosDomainMcpConfig;
};
export type EkairosDomainMcpAuthContext = {
    token?: string;
    orgId?: string;
    userId?: string;
    apiKeyId?: string;
    scopes?: string[];
    isAdmin?: boolean;
    [key: string]: unknown;
};
export type EkairosDomainMcpConfig = {
    required?: boolean;
    resolveAuth?: (input: {
        req: unknown;
        token?: string | null;
    }) => Promise<EkairosDomainMcpAuthContext | null> | EkairosDomainMcpAuthContext | null;
};
export declare function configureEkairosDomain(config?: EkairosDomainConfig): void;
export declare function getEkairosDomain(): EkairosDomainConfig | null;
