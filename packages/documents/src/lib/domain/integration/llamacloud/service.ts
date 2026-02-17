import { LlamaParseOptions, LlamaUploadResponse, LlamaJobStatus, LlamaMarkdownResult, LlamaTextResult } from "./types";

const LLAMA_CLOUD_API_BASE = "https://api.cloud.llamaindex.ai/api/v1";

export class LlamaCloudService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.LLAMA_CLOUD_API_KEY || "";
    
    if (!this.apiKey) {
      throw new Error("LlamaCloud API key is required. Set LLAMA_CLOUD_API_KEY environment variable.");
    }
  }

  private async fetchWithAuth(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${LLAMA_CLOUD_API_BASE}${endpoint}`;
    
    const isFormData = options.body && typeof options.body === "object" && "append" in options.body;
    
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (!isFormData) {
      headers.Accept = "application/json";
      if (options.headers) {
        Object.assign(headers, options.headers);
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `LlamaCloud API error: ${response.status} ${response.statusText}. ${errorText}`
      );
    }

    return response;
  }

  async uploadFile(
    file: Buffer | Blob,
    filename: string,
    options: LlamaParseOptions = {}
  ): Promise<LlamaUploadResponse> {
    const { FormData, File } = await import("formdata-node");
    const formData = new FormData();
    
    if (file instanceof Buffer) {
      const fileObj = new File([file], filename, {
        type: "application/octet-stream",
      });
      formData.append("file", fileObj);
    } else {
      formData.append("file", file, filename);
    }

    if (options.parse_mode) {
      formData.append("parse_mode", options.parse_mode);
    }
    if (options.model) {
      formData.append("model", options.model);
    }
    if (options.high_res_ocr !== undefined) {
      formData.append("high_res_ocr", String(options.high_res_ocr));
    }
    if (options.output_tables_as_HTML !== undefined) {
      formData.append("output_tables_as_HTML", String(options.output_tables_as_HTML));
    }
    if (options.adaptive_long_table !== undefined) {
      formData.append("adaptive_long_table", String(options.adaptive_long_table));
    }
    if (options.outlined_table_extraction !== undefined) {
      formData.append("outlined_table_extraction", String(options.outlined_table_extraction));
    }
    if (options.precise_bounding_box !== undefined) {
      formData.append("precise_bounding_box", String(options.precise_bounding_box));
    }
    if (options.language) {
      formData.append("language", options.language);
    }
    if (options.result_type) {
      formData.append("result_type", options.result_type);
    }

    const response = await this.fetchWithAuth("/parsing/upload", {
      method: "POST",
      body: formData as any,
    });

    const data = await response.json();
    const jobId = typeof data?.id === "string" ? data.id : undefined;
    if (!jobId) {
      throw new Error("LlamaCloud upload response missing id field");
    }
    if (typeof data?.job_id === "string" && data.job_id !== jobId) {
      throw new Error("LlamaCloud upload response mismatch between id and job_id");
    }
    return { job_id: jobId };
  }

  async getJobStatus(jobId: string): Promise<LlamaJobStatus> {
    const response = await this.fetchWithAuth(`/parsing/job/${jobId}`);
    const data = await response.json();
    
    return {
      status: data.status,
      job_id: data.job_id || jobId,
      error: data.error,
    };
  }

  async getResultMarkdown(jobId: string): Promise<LlamaMarkdownResult> {
    const response = await this.fetchWithAuth(`/parsing/job/${jobId}/result/markdown`);
    const data = await response.json();
    
    return {
      pages: data.pages || [],
    };
  }

  async getResultText(jobId: string): Promise<LlamaTextResult> {
    const response = await this.fetchWithAuth(`/parsing/job/${jobId}/result/text`);
    const data = await response.json();
    
    return {
      pages: data.pages || [],
    };
  }

}

