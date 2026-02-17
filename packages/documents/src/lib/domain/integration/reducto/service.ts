import {
  ReductoUploadResponse,
  ReductoParseRequest,
  ReductoParseResponse,
  ReductoJobStatus,
  ReductoExtractRequest,
  ReductoExtractResponse,
  ReductoSplitRequest,
  ReductoSplitResponse,
  ReductoEditRequest,
  ReductoEditResponse,
  ReductoJob,
} from "./types";

const REDUCTO_API_BASE = "https://platform.reducto.ai";

export class ReductoService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.REDUCTO_API_KEY || "";

    if (!this.apiKey) {
      throw new Error("Reducto API key is required. Set REDUCTO_API_KEY environment variable.");
    }
  }

  private async fetchWithAuth(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${REDUCTO_API_BASE}${endpoint}`;

    const isFormData = options.body && typeof options.body === "object" && "append" in options.body;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (!isFormData) {
      headers["Content-Type"] = "application/json";
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
        `Reducto API error: ${response.status} ${response.statusText}. ${errorText}`
      );
    }

    return response;
  }

  /**
   * Upload a file to Reducto
   * POST /upload
   */
  async uploadFile(file: Buffer | Blob, filename: string): Promise<ReductoUploadResponse> {
    const FormData = (await import("formdata-node")).FormData;
    const formData = new FormData();

    if (file instanceof Buffer) {
      const { Blob } = await import("buffer");
      formData.append("file", new Blob([file]), filename);
    } else {
      formData.append("file", file, filename);
    }

    const response = await this.fetchWithAuth("/upload", {
      method: "POST",
      body: formData as any,
    });

    const data = await response.json();
    return {
      url: data.url || data.file_url,
      file_id: data.file_id || data.id,
    };
  }

  /**
   * Parse a document synchronously
   * POST /parse
   */
  async parse(request: ReductoParseRequest): Promise<ReductoParseResponse> {
    const response = await this.fetchWithAuth("/parse", {
      method: "POST",
      body: JSON.stringify(request),
    });

    return await response.json();
  }

  /**
   * Parse a document asynchronously
   * POST /parse/async
   */
  async parseAsync(request: ReductoParseRequest): Promise<{ job_id: string }> {
    const response = await this.fetchWithAuth("/parse/async", {
      method: "POST",
      body: JSON.stringify(request),
    });

    const data = await response.json();
    return { job_id: data.job_id };
  }

  /**
   * Retrieve parse result
   * GET /parse/{job_id}
   */
  async getParseResult(jobId: string): Promise<ReductoParseResponse> {
    const response = await this.fetchWithAuth(`/parse/${jobId}`, {
      method: "GET",
    });

    return await response.json();
  }

  /**
   * Get job status
   * GET /jobs/{job_id}
   */
  async getJobStatus(jobId: string): Promise<ReductoJobStatus> {
    const response = await this.fetchWithAuth(`/jobs/${jobId}`, {
      method: "GET",
    });

    const data = await response.json();
    return {
      job_id: data.job_id || jobId,
      status: data.status,
      error: data.error,
      result: data.result,
    };
  }

  /**
   * Get all jobs
   * GET /jobs
   */
  async getJobs(limit?: number, offset?: number): Promise<ReductoJob[]> {
    const params = new URLSearchParams();
    if (limit) params.append("limit", String(limit));
    if (offset) params.append("offset", String(offset));

    const url = `/jobs${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url, {
      method: "GET",
    });

    const data = await response.json();
    return Array.isArray(data) ? data : data.jobs || [];
  }

  /**
   * Cancel a job
   * POST /cancel
   */
  async cancelJob(jobId: string): Promise<{ success: boolean }> {
    const response = await this.fetchWithAuth("/cancel", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId }),
    });

    const data = await response.json();
    return { success: data.success || true };
  }

  /**
   * Extract structured data from a document
   * POST /extract
   */
  async extract(request: ReductoExtractRequest): Promise<ReductoExtractResponse> {
    const response = await this.fetchWithAuth("/extract", {
      method: "POST",
      body: JSON.stringify(request),
    });

    return await response.json();
  }

  /**
   * Extract structured data asynchronously
   * POST /extract/async
   */
  async extractAsync(request: ReductoExtractRequest): Promise<{ job_id: string }> {
    const response = await this.fetchWithAuth("/extract/async", {
      method: "POST",
      body: JSON.stringify(request),
    });

    const data = await response.json();
    return { job_id: data.job_id };
  }

  /**
   * Split a document into sections
   * POST /split
   */
  async split(request: ReductoSplitRequest): Promise<ReductoSplitResponse> {
    const response = await this.fetchWithAuth("/split", {
      method: "POST",
      body: JSON.stringify(request),
    });

    return await response.json();
  }

  /**
   * Split a document asynchronously
   * POST /split/async
   */
  async splitAsync(request: ReductoSplitRequest): Promise<{ job_id: string }> {
    const response = await this.fetchWithAuth("/split/async", {
      method: "POST",
      body: JSON.stringify(request),
    });

    const data = await response.json();
    return { job_id: data.job_id };
  }

  /**
   * Edit a document (fill forms, etc.)
   * POST /edit
   */
  async edit(request: ReductoEditRequest): Promise<ReductoEditResponse> {
    const response = await this.fetchWithAuth("/edit", {
      method: "POST",
      body: JSON.stringify(request),
    });

    return await response.json();
  }

  /**
   * Edit a document asynchronously
   * POST /edit/async
   */
  async editAsync(request: ReductoEditRequest): Promise<{ job_id: string }> {
    const response = await this.fetchWithAuth("/edit/async", {
      method: "POST",
      body: JSON.stringify(request),
    });

    const data = await response.json();
    return { job_id: data.job_id };
  }
}



