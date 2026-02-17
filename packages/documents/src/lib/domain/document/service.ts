import { InstantAdminDatabase } from "@instantdb/admin";
import { id } from "@instantdb/core";
import { ProviderResultNotReadyError } from "./providers";
import type {
  DocumentParseProvider,
  ProviderJobRef,
  ProviderResultType,
  NormalizedParseResult,
} from "./providers";
import { ParseDocument, ParseJob, ParsePage, ParsePreset, ParseResultType } from "./types";
import { getPresetConfig } from "./presets";
import type { DocumentsSchema } from "../../domain";

export class DocumentService {
  constructor(
    private readonly db: InstantAdminDatabase<DocumentsSchema>,
    private readonly provider: DocumentParseProvider
  ) {}

  async createDocument(
    fileId: string,
    name: string,
    mimeType: string,
    size: number,
    ownerId: string,
    orgId?: string
  ): Promise<string> {
    const documentId = id();
    const now = new Date();

    const transactions = [
      this.db.tx.document_documents[documentId].update({
        name,
        mimeType,
        size,
        ownerId,
        orgId,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.tx.document_documents[documentId].link({ file: fileId }),
    ];

    if (orgId) {
      const orgData = await this.db.query({
        organizations: { $: { where: { clerkOrgId: orgId } } },
      });
      const organization = orgData.organizations?.[0];
      if (organization) {
        transactions.push(
          this.db.tx.organizations[organization.id].link({
            documents: documentId,
          })
        );
      }
    }

    await this.db.transact(transactions);
    return documentId;
  }

  /**
   * Start a parse job by uploading to Reducto and initiating async parse
   */
  async startParseJob(
    documentId: string,
    fileBuffer: Buffer,
    preset: ParsePreset,
    resultType: ParseResultType = "markdown"
  ): Promise<string> {
    const document = await this.getDocumentById(documentId);
    if (!document) {
      throw new Error(`Document with id ${documentId} not found`);
    }

    const presetConfig = getPresetConfig(preset);
    const providerResultType = resultType as ProviderResultType;
    const jobId = id();
    const now = new Date();

    // Create job record with queued status and chosen provider
    const transactions = [
      this.db.tx.document_jobs[jobId].update({
        documentId,
        provider: this.provider.name,
        status: "queued",
        preset,
        config: presetConfig,
        resultType: providerResultType,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.tx.document_documents[documentId].link({ jobs: jobId }),
    ];

    await this.db.transact(transactions);

    try {
      // Use provider to upload+start
      const ref: ProviderJobRef = await this.provider.uploadAndStartParse(
        fileBuffer,
        document.name,
        { resultType: providerResultType, config: presetConfig }
      );

      // Update job with provider IDs
      await this.db.transact([
        this.db.tx.document_jobs[jobId].update({
          externalJobId: ref.externalJobId,
          externalFileUrl: ref.fileUrl,
          status: "processing",
          resultType: providerResultType,
          updatedAt: new Date(),
        }),
        this.db.tx.document_documents[documentId].update({
          lastJobId: jobId,
          updatedAt: new Date(),
        }),
      ]);

      // Persist provider-specific raw job entity and link
      await this.persistProviderJobRaw(jobId, ref);

      return jobId;
    } catch (error) {
      await this.db.transact([
        this.db.tx.document_jobs[jobId].update({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        }),
      ]);
      throw error;
    }
  }

  /**
   * Poll Reducto job status and persist results when completed
   */
  async pollAndPersistResult(jobId: string): Promise<void> {
    const job = await this.getJobById(jobId);
    if (!job) {
      throw new Error(`Job with id ${jobId} not found`);
    }

    if (!job.externalJobId) {
      throw new Error(`Job ${jobId} has no external provider id`);
    }

    const status = await this.provider.getStatus(job.externalJobId);

    if (status.status === "success") {
      let parseResult: NormalizedParseResult;
      try {
        const jobResultType = (job.resultType as ProviderResultType) || "markdown";
        parseResult = await this.provider.fetchResult(job.externalJobId, {
          resultType: jobResultType,
        });
      } catch (error) {
        if (error instanceof ProviderResultNotReadyError) {
          await this.db.transact([
            this.db.tx.document_jobs[jobId].update({
              status: "processing",
              updatedAt: new Date(),
            }),
          ]);
          return;
        }

        throw error;
      }

      const now = new Date();
      const transactions = [
        this.db.tx.document_jobs[jobId].update({
          status: "success",
          pagesCount: parseResult.pages.length,
          creditsUsed: parseResult.usage?.credits,
          completedAt: now,
          updatedAt: now,
        }),
      ];

      // Persist pages with bounding boxes
      for (const page of parseResult.pages) {
        const pageId = id();
        const boundingBoxes = page.boundingBoxes || [];
        const blocks = page.blocks || [];
/*
        transactions.push(
          this.db.tx.document_pages[pageId].update({
            jobId,
            documentId: job.documentId,
            pageIndex: page.pageIndex,
            text: page.text,
            markdown: page.markdown,
            layout: {
              blocks,
              tables: page.tables,
              figures: page.figures,
            },
            boundingBoxes,
            createdAt: now,
          }),
          this.db.tx.document_jobs[jobId].link({ pages: pageId })
        );
        */ // TODO: FIX SCHEMA DOMAIN
      }

      await this.db.transact(transactions);
      // update provider raw response
      await this.persistProviderResponseRaw(jobId, parseResult.raw);
    } else if (status.status === "failed") {
      await this.db.transact([
        this.db.tx.document_jobs[jobId].update({
          status: "failed",
          error: status.error || "Unknown error",
          completedAt: new Date(),
          updatedAt: new Date(),
        }),
      ]);
    } else {
      // Update status (queued, processing, canceled)
      await this.db.transact([
        this.db.tx.document_jobs[jobId].update({
          status: status.status,
          updatedAt: new Date(),
        }),
      ]);
    }
  }

  private async persistProviderJobRaw(jobId: string, ref: ProviderJobRef): Promise<void> {
    const now = new Date();
    if (this.provider.name === "reducto") {
      await this.db.transact([
        this.db.tx.documentProviderReducto_jobs[jobId].update({
          externalJobId: ref.externalJobId,
          fileUrl: ref.fileUrl,
          request: ref.requestRaw,
          status: "processing",
          createdAt: now,
          updatedAt: now,
        }),
        this.db.tx.document_jobs[jobId].link({ reductoJob: jobId }),
      ]);
    } else if (this.provider.name === "llamacloud") {
      await this.db.transact([
        this.db.tx.documentProviderLlamacloud_jobs[jobId].update({
          externalJobId: ref.externalJobId,
          request: ref.requestRaw,
          status: "processing",
          createdAt: now,
          updatedAt: now,
        }),
        this.db.tx.document_jobs[jobId].link({ llamacloudJob: jobId }),
      ]);
    } else if (this.provider.name === "chunkr") {
      await this.db.transact([
        this.db.tx.documentProviderChunkr_jobs[jobId].update({
          externalJobId: ref.externalJobId,
          fileUrl: ref.fileUrl,
          request: ref.requestRaw,
          status: "processing",
          createdAt: now,
          updatedAt: now,
        }),
        this.db.tx.document_jobs[jobId].link({ chunkrJob: jobId }),
      ]);
    }
  }

  private async persistProviderResponseRaw(jobId: string, raw: unknown): Promise<void> {
    if (this.provider.name === "reducto") {
      await this.db.transact([
        this.db.tx.documentProviderReducto_jobs[jobId].update({ response: raw, status: "success", updatedAt: new Date() }),
      ]);
    } else if (this.provider.name === "llamacloud") {
      await this.db.transact([
        this.db.tx.documentProviderLlamacloud_jobs[jobId].update({ response: raw, status: "success", updatedAt: new Date() }),
      ]);
    } else if (this.provider.name === "chunkr") {
      await this.db.transact([
        this.db.tx.documentProviderChunkr_jobs[jobId].update({ response: raw, status: "success", updatedAt: new Date() }),
      ]);
    }
  }

  async getProviderRawResult(jobId: string): Promise<unknown> {
    const job = await this.getJobById(jobId);
    if (!job?.externalJobId) {
      throw new Error("Job has no external provider id");
    }
    const jobResultType = (job.resultType as ProviderResultType) || "raw";
    const result = await this.provider.fetchResult(job.externalJobId, {
      resultType: jobResultType,
    });
    return result.raw ?? result;
  }

  async getDocumentById(id: string): Promise<ParseDocument | null> {
    // TODO: Replace mock implementation with a real database query.
    // The following returns a mocked ParseDocument object for testing.
    return {
      id,
      file: {},
      jobs: [],
      // Add further mock fields if needed
    } as unknown as ParseDocument;
  }

  async getJobById(id: string): Promise<ParseJob | null> {
    // TODO: Replace mock implementation with a real database query.
    // The following returns a mocked ParseJob object for testing.
    // Original code:
    // const result = await this.db.query({
    //   document_jobs: {
    //     $: { where: { id } },
    //     document: {},
    //     pages: {
    //       $: { order: { pageIndex: "asc" } },
    //     },
    //   },
    // });
    //
    // return (result.document_jobs?.[0] as unknown as ParseJob) || null;

    // Mocked return for demonstration/testing purposes
    return {
      id,
      document: {},
      pages: [],
      // Add further mock fields if needed
    } as unknown as ParseJob;
  }

  async getPagesByJob(jobId: string): Promise<ParsePage[]> {
    const result = await this.db.query({
      document_pages: {
        $: {
          where: { jobId },
          order: { pageIndex: "asc" },
        },
      },
    });

    return (result.document_pages || []) as unknown as ParsePage[];
  }

  async listDocumentsByOwner(
    ownerId: string,
    orgId?: string
  ): Promise<ParseDocument[]> {
    const where: any = { ownerId };
    if (orgId) {
      where.orgId = orgId;
    }

    // TODO: Replace mock implementation with a real database query.
    // Original implementation:
    // const result = await this.db.query({
    //   document_documents: {
    //     $: {
    //       where,
    //       order: { createdAt: "desc" },
    //     },
    //     jobs: {
    //       $: { order: { createdAt: "desc" } },
    //     },
    //   },
    // });
    //
    // return (result.document_documents || []) as unknown as ParseDocument[];

    // Mocked return for demonstration/testing purposes
    return [
      {
        id: "mock-document-1",
        ownerId,
        orgId,
        jobs: [],
        // Add further mock fields if needed
      }
    ] as unknown as ParseDocument[];
  }
}
