export type DocumentProviderName = "reducto" | "llamacloud" | "chunkr";

export type ProviderResultType = "markdown" | "text" | "raw";

export interface ProviderFetchOptions {
  resultType?: ProviderResultType;
}

export type ProviderJobStatus =
  | "queued"
  | "processing"
  | "success"
  | "failed"
  | "canceled";

export interface ProviderJobRef {
  provider: DocumentProviderName;
  externalJobId: string;
  fileUrl?: string;
  requestRaw?: unknown;
}

export interface NormalizedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
}

export interface NormalizedPageBlock {
  type: string;
  text?: string;
  boundingBox?: NormalizedBoundingBox;
  confidence?: number;
}

export interface NormalizedParsePage {
  pageIndex: number; // 0-based
  text?: string;
  markdown?: string;
  blocks?: NormalizedPageBlock[];
  boundingBoxes?: NormalizedBoundingBox[];
  tables?: unknown[];
  figures?: unknown[];
}

export interface NormalizedParseResult {
  pages: NormalizedParsePage[];
  usage?: { pages?: number; credits?: number };
  raw?: unknown;
}

export interface DocumentParseProvider {
  readonly name: DocumentProviderName;
  readonly supportedResultTypes: ProviderResultType[];
  uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: { resultType: ProviderResultType; config?: unknown }
  ): Promise<ProviderJobRef>;

  getStatus(externalJobId: string): Promise<{ status: ProviderJobStatus; error?: string }>;

  fetchResult(externalJobId: string, options?: ProviderFetchOptions): Promise<NormalizedParseResult>;
}

export class ProviderResultNotReadyError extends Error {
  constructor(message?: string) {
    super(message ?? "Provider result not ready");
    this.name = "ProviderResultNotReadyError";
  }
}



