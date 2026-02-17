import { ReductoService } from "../../integration/reducto/service";
import type { ReductoParseRequest } from "../../integration/reducto/types";
import type {
  DocumentParseProvider,
  DocumentProviderName,
  ProviderFetchOptions,
  ProviderJobRef,
  ProviderJobStatus,
  ProviderResultType,
  NormalizedParseResult,
} from "./provider";

export class ReductoProvider implements DocumentParseProvider {
  public readonly name: DocumentProviderName = "reducto";
  public readonly supportedResultTypes: ProviderResultType[] = ["markdown", "text", "raw"];
  private svc: ReductoService;

  constructor(service?: ReductoService) {
    this.svc = service ?? new ReductoService();
  }

  async uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: { resultType: ProviderResultType; config?: unknown }
  ): Promise<ProviderJobRef> {
    const upload = await this.svc.uploadFile(file, filename);
    const parseRequest: ReductoParseRequest = {
      input: upload.url,
    };

    if (options.config && typeof options.config === "object") {
      Object.assign(parseRequest, options.config);
    }

    const parseJob = await this.svc.parseAsync(parseRequest);
    return {
      provider: this.name,
      externalJobId: parseJob.job_id,
      fileUrl: upload.url,
      requestRaw: { upload, parse: parseRequest },
    };
  }

  async getStatus(externalJobId: string): Promise<{ status: ProviderJobStatus; error?: string }> {
    const status = await this.svc.getJobStatus(externalJobId);
    // map completed->success
    const mapped = status.status === "completed" ? "success" : (status.status as ProviderJobStatus);
    return { status: mapped, error: status.error };
  }

  async fetchResult(externalJobId: string, _options?: ProviderFetchOptions): Promise<NormalizedParseResult> {
    const res = await this.svc.getParseResult(externalJobId);
    const pages = (res.result?.pages || []).map((p: any) => ({
      pageIndex: Math.max(0, (p.page ?? 1) - 1),
      text: p.text,
      markdown: p.markdown,
      blocks: p.blocks,
      boundingBoxes: p.bounding_boxes,
      tables: (res.result?.tables || []).filter((t: any) => t.page === p.page),
      figures: (res.result?.figures || []).filter((f: any) => f.page === p.page),
    }));
    return {
      pages,
      usage: { pages: res.usage?.num_pages, credits: res.usage?.credits },
      raw: res,
    };
  }
}



