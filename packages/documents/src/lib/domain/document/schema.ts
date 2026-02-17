import { i } from "@instantdb/core";
import { domain } from "@ekairos/domain";

const entities = {
  document_documents: i.entity({
    name: i.string().optional().indexed(),
    mimeType: i.string().optional(),
    size: i.number().optional(),
    ownerId: i.string().optional().indexed(),
    orgId: i.string().optional().indexed(),
    createdAt: i.date().optional().indexed(),
    updatedAt: i.date().optional(),
    lastJobId: i.string().optional(),
  }),
  document_jobs: i.entity({
    documentId: i.string().optional().indexed(),
    provider: i.string().optional().indexed(),
    externalJobId: i.string().optional().unique().indexed(),
    externalFileUrl: i.string().optional(),
    status: i.string().optional().indexed(),
    preset: i.string().optional(),
    config: i.json().optional(),
    resultType: i.string().optional(),
    createdAt: i.date().optional().indexed(),
    updatedAt: i.date().optional(),
    completedAt: i.date().optional(),
    error: i.string().optional(),
    pagesCount: i.number().optional(),
    creditsUsed: i.number().optional(),
  }),
  document_pages: i.entity({
    jobId: i.string().optional().indexed(),
    documentId: i.string().optional().indexed(),
    pageIndex: i.number().optional().indexed(),
    text: i.string().optional(),
    markdown: i.string().optional(),
    layout: i.json().optional(),
    structuredData: i.json().optional(),
    boundingBoxes: i.json().optional(),
    createdAt: i.date().optional().indexed(),
  }),
};

const links = {
  documentFile: {
    forward: {
      on: "document_documents",
      has: "one",
      label: "file",
    },
    reverse: {
      on: "$files",
      has: "one",
      label: "document",
    },
  },
  documentJobs: {
    forward: {
      on: "document_documents",
      has: "many",
      label: "jobs",
    },
    reverse: {
      on: "document_jobs",
      has: "one",
      label: "document",
    },
  },
  documentPages: {
    forward: {
      on: "document_jobs",
      has: "many",
      label: "pages",
    },
    reverse: {
      on: "document_pages",
      has: "one",
      label: "job",
      onDelete: "cascade",
    },
  },
  organizationDocuments: {
    forward: {
      on: "organizations",
      has: "many",
      label: "documents",
    },
    reverse: {
      on: "document_documents",
      has: "one",
      label: "organization",
    },
  },
} as const;

const rooms = {} as const;

export const documentDomain = domain({
  name: "documents",
  packageName: "@ekairos/documents",
}).schema({ entities, links, rooms });

