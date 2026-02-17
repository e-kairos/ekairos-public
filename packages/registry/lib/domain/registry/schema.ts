import { i } from "@instantdb/react";
import { domain } from "@ekairos/domain";

export const registryDomain = domain("registry")
  .schema({
    entities: {
      registry_repositories: i.entity({
        url: i.string().unique().indexed(),
        name: i.string(),
        lastSyncedAt: i.number().optional(),
        defaultBranch: i.string().optional(),
      }),
      registry_commits: i.entity({
        hash: i.string().unique().indexed(),
        message: i.string(),
        date: i.number(),
        author: i.string(),
      }),
      registry_packages: i.entity({ // Renamed from registry_libs
        name: i.string().indexed(), // e.g. "zod", "lucide-react"
        version: i.string(), // e.g. "^3.2.0"
        type: i.string().optional(), // e.g. "dependency", "peerDependency", "devDependency"
        key: i.string().unique().indexed(), // composite key: "name@version" to ensure uniqueness
      }),
      registry_components: i.entity({
        name: i.string().unique().indexed(), // e.g. "button"
        type: i.string(), // e.g. "registry:component"
        title: i.string(),
        description: i.string().optional(),
        cssVars: i.any().optional(),
        meta: i.any().optional(),
        version: i.string().optional(),
      }),
      registry_files: i.entity({
        path: i.string(), // relative path e.g. "ui/button.tsx"
        // content: i.string(), // Removed, using $files link
        type: i.string(), // e.g. "registry:component"
        target: i.string().optional(),
      }),
    },
    links: {
      repoCommits: {
        forward: { on: "registry_commits", has: "one", label: "repository" },
        reverse: { on: "registry_repositories", has: "many", label: "commits" },
      },
      componentRepo: {
        forward: { on: "registry_components", has: "one", label: "repository" },
        reverse: { on: "registry_repositories", has: "many", label: "components" },
      },
      componentFiles: {
        forward: { on: "registry_files", has: "one", label: "component" },
        reverse: { on: "registry_components", has: "many", label: "files" },
      },
      commitComponents: {
        // Track which components were touched in a commit
        forward: { on: "registry_components", has: "many", label: "commits" },
        reverse: { on: "registry_commits", has: "many", label: "components" },
      },
      // Dependencies (NPM packages)
      componentPackages: { // Renamed from componentLibs
        forward: { on: "registry_packages", has: "many", label: "usedByComponents" },
        reverse: { on: "registry_components", has: "many", label: "dependencies" },
      },
      // Registry Dependencies (Internal components)
      componentRegistryDeps: {
        forward: { on: "registry_components", has: "many", label: "usedBy" },
        reverse: { on: "registry_components", has: "many", label: "registryDependencies" },
      },
      // File Storage Link
      fileStorage: {
        forward: { on: "registry_files", has: "one", label: "storage" },
        reverse: { on: "$files", has: "one", label: "registryFile" },
      },
    },
  });
