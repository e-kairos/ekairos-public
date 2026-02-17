import { LlamaCloudService } from "../../integration/llamacloud/service";
import type { LlamaParseMode, LlamaParseModel, LlamaParseOptions } from "../../integration/llamacloud/types";
import {
  ProviderResultNotReadyError,
} from "./provider";
import type {
  DocumentParseProvider,
  DocumentProviderName,
  ProviderFetchOptions,
  ProviderJobRef,
  ProviderJobStatus,
  ProviderResultType,
  NormalizedParseResult,
  NormalizedParsePage,
} from "./provider";

export class LlamaCloudProvider implements DocumentParseProvider {
  public readonly name: DocumentProviderName = "llamacloud";
  public readonly supportedResultTypes: ProviderResultType[] = ["markdown", "text"];
  private svc: LlamaCloudService;

  constructor(service?: LlamaCloudService) {
    this.svc = service ?? new LlamaCloudService();
  }

  async uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: { resultType: "markdown" | "text"; config?: unknown }
  ): Promise<ProviderJobRef> {
    const uploadOptions = this.buildUploadOptions(options.config);
    uploadOptions.result_type = options.resultType;

    const upload = await this.svc.uploadFile(file, filename, uploadOptions);
    const externalJobId = upload.job_id;
    if (!externalJobId) {
      throw new Error("LlamaCloud upload response missing job_id");
    }
    return {
      provider: this.name,
      externalJobId,
      requestRaw: { upload },
    };
  }

  async getStatus(externalJobId: string): Promise<{ status: ProviderJobStatus; error?: string }> {
    const status = await this.svc.getJobStatus(externalJobId);
    const normalized = (status.status || "").toLowerCase();
    return { status: normalized as ProviderJobStatus, error: status.error };
  }

  async fetchResult(
    externalJobId: string,
    options?: ProviderFetchOptions
  ): Promise<NormalizedParseResult> {
    const resultType: ProviderResultType = options?.resultType ?? "markdown";

    if (resultType === "markdown") {
      const { payload, pages } = await this.waitForResult(
        externalJobId,
        async () => this.svc.getResultMarkdown(externalJobId),
        (markdown: any) => (Array.isArray(markdown?.pages) ? markdown.pages : []),
        "markdown"
      );

      const normalizedPages = pages.map((page: any, index: number) => ({
        pageIndex: Math.max(0, page.page ? page.page - 1 : index),
        markdown: page.md,
        text: page.text,
      }));

      return { pages: normalizedPages, raw: payload };
    }

    const { payload, pages } = await this.waitForResult(
      externalJobId,
      async () => this.svc.getResultText(externalJobId),
      (text: any) => (Array.isArray(text?.pages) ? text.pages : []),
      "text"
    );

    const normalizedPages = pages.map((page: any, index: number) => ({
      pageIndex: Math.max(0, page.page ? page.page - 1 : index),
      text: page.text,
    }));

    return { pages: normalizedPages, raw: payload };
  }

  private async waitForResult<T>(
    externalJobId: string,
    fetcher: () => Promise<T>,
    pageExtractor: (payload: T) => any[],
    label: ProviderResultType
  ): Promise<{ payload: T; pages: any[] }> {
    const maxAttempts = 12;
    const delayMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const payload = await fetcher();
        const pages = pageExtractor(payload);

        if (pages.length > 0) {
          return { payload, pages };
        }

        // LlamaCloud returned payload but no pages - this is expected for PDFs with no parseable content
      } catch (error) {
        if (error instanceof Error && error.message.includes("404")) {
          // Result not ready yet, continue polling
          throw error;
        }
      }

      if (attempt < maxAttempts - 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
    }

    throw new ProviderResultNotReadyError(`LlamaCloud ${label} result not ready after ${maxAttempts} attempts`);
  }

  private buildUploadOptions(config?: unknown): LlamaParseOptions {
    const options: LlamaParseOptions = {};

    if (!config || typeof config !== "object") {
      return options;
    }

    const source = config as Record<string, unknown>;

    if (typeof source.parse_mode === "string") {
      options.parse_mode = source.parse_mode as LlamaParseMode;
    }

    if (typeof source.model === "string") {
      options.model = source.model as LlamaParseModel;
    }

    if (typeof source.high_res_ocr === "boolean") {
      options.high_res_ocr = source.high_res_ocr;
    }

    if (typeof source.output_tables_as_HTML === "boolean") {
      options.output_tables_as_HTML = source.output_tables_as_HTML;
    }

    if (typeof source.adaptive_long_table === "boolean") {
      options.adaptive_long_table = source.adaptive_long_table;
    }

    if (typeof source.outlined_table_extraction === "boolean") {
      options.outlined_table_extraction = source.outlined_table_extraction;
    }

    if (typeof source.precise_bounding_box === "boolean") {
      options.precise_bounding_box = source.precise_bounding_box;
    }

    if (typeof source.language === "string") {
      options.language = source.language;
    }

    if (typeof source.result_type === "string") {
      const result = source.result_type.toLowerCase();
      if (result === "markdown" || result === "text" || result === "raw") {
        options.result_type = result;
      }
    }

    return options;
  }
}

function extractRawPages(raw: unknown): any[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const payload: any = raw;

  if (Array.isArray(payload.pages)) {
    return payload.pages;
  }

  if (Array.isArray(payload.result?.pages)) {
    return payload.result.pages;
  }

  if (Array.isArray(payload.result?.documents)) {
    return payload.result.documents.flatMap((document: any) =>
      Array.isArray(document.pages) ? document.pages : []
    );
  }

  if (Array.isArray(payload.documents)) {
    return payload.documents.flatMap((document: any) =>
      Array.isArray(document.pages) ? document.pages : []
    );
  }

  if (Array.isArray(payload.result?.sections)) {
    return payload.result.sections.flatMap((section: any) =>
      Array.isArray(section.pages) ? section.pages : []
    );
  }

  if (Array.isArray(payload.items)) {
    return payload.items.flatMap((item: any) =>
      Array.isArray(item.pages) ? item.pages : []
    );
  }

  return [];
}

function normalizePage(page: any, index: number): NormalizedParsePage {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const figures = Array.isArray(page.figures) ? page.figures : [];
  const tables = Array.isArray(page.tables) ? page.tables : [];
  const layoutBlocks = Array.isArray(page.layout?.blocks)
    ? page.layout.blocks
    : [];
  const allBlocks = blocks.concat(layoutBlocks);

  return {
    pageIndex: page.page ? Math.max(0, page.page - 1) : index,
    text: page.text || page.raw_text || page.content,
    markdown: page.md || page.markdown,
    blocks: allBlocks.map((block: any) => ({
      type: block.type || block.category,
      text: block.text || block.value,
      boundingBox:
        block.bounding_box || block.bbox || block.boundingBox || undefined,
      confidence: block.confidence || block.score,
    })),
    boundingBoxes: Array.isArray(page.bounding_boxes)
      ? page.bounding_boxes
      : undefined,
    tables: tables.map((table: any) => ({
      content: table.content || table.markdown || table.html,
      boundingBox:
        table.bounding_box || table.bbox || table.boundingBox || undefined,
    })),
    figures: figures.map((figure: any) => ({
      caption: figure.caption,
      imageUrl: figure.image_url || figure.imageUrl,
      boundingBox:
        figure.bounding_box || figure.bbox || figure.boundingBox || undefined,
    })),
  };
}


