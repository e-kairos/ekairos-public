import { i } from "@instantdb/core";
import { domain } from "@ekairos/domain";

const entities = {
  // Reducto raw storage
  documentProviderReducto_jobs: i.entity({
    externalJobId: i.string().indexed().unique(),
    fileUrl: i.string().optional(),
    request: i.any().optional(),
    response: i.any().optional(),
    status: i.string().indexed().optional(),
    error: i.string().optional(),
    creditsUsed: i.number().optional(),
    createdAt: i.date().indexed().optional(),
    updatedAt: i.date().optional(),
  }),

  // LlamaCloud raw storage
  documentProviderLlamacloud_jobs: i.entity({
    externalJobId: i.string().indexed().unique(),
    request: i.any().optional(),
    response: i.any().optional(),
    status: i.string().indexed().optional(),
    error: i.string().optional(),
    createdAt: i.date().indexed().optional(),
    updatedAt: i.date().optional(),
  }),

  // Chunkr raw storage
  documentProviderChunkr_jobs: i.entity({
    externalJobId: i.string().indexed().unique(),
    fileUrl: i.string().optional(),
    request: i.any().optional(),
    response: i.any().optional(),
    status: i.string().indexed().optional(),
    error: i.string().optional(),
    createdAt: i.date().indexed().optional(),
    updatedAt: i.date().optional(),
  }),
};

const links = {
  documentJobReducto: {
    forward: { on: "document_jobs", has: "one", label: "reductoJob" },
    reverse: { on: "documentProviderReducto_jobs", has: "one", label: "documentJob" },
  },
  documentJobLlamacloud: {
    forward: { on: "document_jobs", has: "one", label: "llamacloudJob" },
    reverse: { on: "documentProviderLlamacloud_jobs", has: "one", label: "documentJob" },
  },
  documentJobChunkr: {
    forward: { on: "document_jobs", has: "one", label: "chunkrJob" },
    reverse: { on: "documentProviderChunkr_jobs", has: "one", label: "documentJob" },
  },
} as const;

export const documentProvidersDomain = domain({
  name: "documents.providers",
  packageName: "@ekairos/documents",
}).schema({ entities, links, rooms: {} as const });


