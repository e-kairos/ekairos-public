import type {
  DocumentParseProvider,
  DocumentProviderName,
  ProviderFetchOptions,
  ProviderJobRef,
  ProviderJobStatus,
  ProviderResultType,
  NormalizedParseResult,
} from "./provider";

/**
 * Minimal Chunkr REST client. Endpoints may vary; keep configurable.
 * Docs: https://docs.chunkr.ai/
 */
class ChunkrService {
  constructor(private apiKey: string = process.env.CHUNKR_API_KEY || "", private baseUrl: string = process.env.CHUNKR_API_BASE || "https://api.chunkr.ai") {
    if (!this.apiKey) {
      throw new Error("CHUNKR_API_KEY is required");
    }
  }

  private async fetchJson(path: string, init: RequestInit): Promise<any> {
    const headers: any = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (!(init.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      throw new Error(`Chunkr API error: ${res.status} ${await res.text()}`);
    }
    return await res.json();
  }

  async upload(file: Buffer, filename: string): Promise<{ file_url: string }> {
    const { FormData } = await import("formdata-node");
    const { Blob } = await import("buffer");
    const fd = new FormData();
    fd.append("file", new Blob([file]), filename);
    const data = await this.fetchJson("/upload", { method: "POST", body: fd as any });
    return { file_url: data.url || data.file_url };
  }

  async parseAsync(inputUrl: string, config?: Record<string, unknown>): Promise<{ job_id: string }> {
    const data = await this.fetchJson("/parse/async", {
      method: "POST",
      body: JSON.stringify({ input: inputUrl, ...(config || {}) }),
    });
    return { job_id: data.job_id };
  }

  async job(jobId: string): Promise<{ status: string; error?: string }> {
    const data = await this.fetchJson(`/jobs/${jobId}`, { method: "GET" });
    return { status: data.status, error: data.error };
  }

  async result(jobId: string): Promise<any> {
    return await this.fetchJson(`/parse/${jobId}`, { method: "GET" });
  }
}

export class ChunkrProvider implements DocumentParseProvider {
  public readonly name: DocumentProviderName = "chunkr";
  public readonly supportedResultTypes: ProviderResultType[] = ["markdown", "text", "raw"];
  private svc: ChunkrService;

  constructor(service?: ChunkrService) {
    this.svc = service ?? new ChunkrService();
  }

  async uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: { resultType: ProviderResultType; config?: Record<string, unknown> }
  ): Promise<ProviderJobRef> {
    const upload = await this.svc.upload(file, filename);
    const job = await this.svc.parseAsync(upload.file_url, options?.config);
    return {
      provider: this.name,
      externalJobId: job.job_id,
      fileUrl: upload.file_url,
      requestRaw: { upload, parse: { input: upload.file_url, ...(options?.config || {}) } },
    };
  }

  async getStatus(externalJobId: string): Promise<{ status: ProviderJobStatus; error?: string }> {
    const s = await this.svc.job(externalJobId);
    const mapped = s.status === "completed" ? "success" : (s.status as ProviderJobStatus);
    return { status: mapped, error: s.error };
  }

  async fetchResult(externalJobId: string, _options?: ProviderFetchOptions): Promise<NormalizedParseResult> {
    const raw = await this.svc.result(externalJobId);
    // Normalize best-effort: expect raw.result.pages or raw.pages
    const pagesArr: any[] = raw?.result?.pages || raw?.pages || [];
    const normalized = pagesArr.map((p: any, idx: number) => ({
      pageIndex: typeof p.page === "number" ? Math.max(0, p.page - 1) : idx,
      text: p.text,
      markdown: p.markdown || p.md,
      blocks: p.blocks,
      boundingBoxes: p.bounding_boxes || p.bboxes,
      tables: p.tables,
      figures: p.figures,
    }));
    return { pages: normalized, raw };
  }
}



