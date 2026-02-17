import "server-only";

import { id, tx, InstantAdminDatabase } from "@instantdb/admin";
import { init } from "@instantdb/admin";
import schema, { AppSchema } from "@/instant.schema";
import { GitHubIntegrationService } from "../integration/github/service";
import { SandboxService } from "../sandbox/service";

// Helper types
type AppDatabase = InstantAdminDatabase<AppSchema>;

export class RegistryService {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  /**
   * Registers a new Git repository in the registry.
   */
  async registerRepository(url: string, name: string) {
    // Check if repo exists
    const existing = await this.db.query({
      registry_repositories: {
        $: { where: { url } },
      },
    });

    if (existing.registry_repositories.length > 0) {
      return {
        success: false,
        error: "Repository already registered",
        data: existing.registry_repositories[0],
      };
    }

    const repoId = id();
    await this.db.transact(
      tx.registry_repositories[repoId].update({
        url,
        name,
        lastSyncedAt: 0,
      })
    );

    return {
      success: true,
      data: { id: repoId, url, name },
    };
  }

  /**
   * Syncs a repository from Git using a sandbox.
   * This clones the repo, reads components.json, and syncs content.
   */
  async syncFromGit(params: {
    clerkOrgId: string;
    repoId: string;
  }) {
    const { clerkOrgId, repoId } = params;

    // 1. Get Repo
    const repoQuery = await this.db.query({
      registry_repositories: {
        $: { where: { id: repoId } },
      },
    });
    const repo = repoQuery.registry_repositories[0];
    if (!repo) throw new Error("Repository not found");

    // 2. Setup Sandbox
    const sandboxService = new SandboxService(this.db);
    const sandboxRes = await sandboxService.createSandbox({ template: "node" });
    if (!sandboxRes.ok) throw new Error("Failed to create sandbox");
    const { sandboxId } = sandboxRes.data;

    // 3. Clone Repository
    const cloneRes = await GitHubIntegrationService.cloneRepository({
      clerkOrgId,
      repoUrl: repo.url,
      sandboxId,
      depth: 1, // Shallow clone for latest version
    });

    if (!cloneRes.ok) throw new Error(`Clone failed: ${cloneRes.error}`);

    // 4. Read components.json
    const configRes = await GitHubIntegrationService.readFile({
      clerkOrgId,
      sandboxId,
      path: "components.json",
    });

    if (!configRes.ok) throw new Error(`Failed to read components.json: ${configRes.error}`);
    const config = JSON.parse(configRes.data);

    // 5. Get Head Commit Info (git log -1)
    const logRes = await sandboxService.runCommand(sandboxId, 'git log -1 --format="%H|%s|%an|%at"');
    if (!logRes.ok || logRes.data.exitCode !== 0) throw new Error("Failed to get commit info");
    const [hash, message, author, dateStr] = logRes.data.stdout.trim().split("|");
    const commitDate = parseInt(dateStr, 10) * 1000;

    // 6. Create Commit Entity
    const commitId = id();
    await this.db.transact(
      tx.registry_commits[commitId].update({
        hash,
        message,
        author,
        date: commitDate,
      }).link({ repository: repoId })
    );

    // 7. Process Components
    // Assuming config structure: { items: [...] } or just array?
    // Shadcn uses different formats depending on version. Let's assume standard items array.
    const items = Array.isArray(config) ? config : config.items || [];

    for (const item of items) {
      // Read source files
      // item.files is usually an array of paths relative to the repo root or configured root.
      const files: Array<{ path: string; content: string; type: string; target?: string }> = [];
      
      for (const filePath of (item.files || [])) {
        const fileRes = await GitHubIntegrationService.readFile({
          clerkOrgId,
          sandboxId,
          path: filePath,
        });
        
        if (fileRes.ok) {
          files.push({
            path: filePath,
            content: fileRes.data,
            type: "registry:component", // Default
          });
        } else {
          console.warn(`Failed to read file ${filePath} for component ${item.name}`);
        }
      }

      // Upsert Component
      await this.upsertComponent(
        {
          name: item.name,
          type: item.type || "registry:component",
          title: item.title || item.name,
          description: item.description,
          version: item.version,
          meta: item.meta,
          cssVars: item.cssVars,
        },
        files,
        item.dependencies?.map((d: string) => {
            // Primitive parsing: "zod" or "zod@3.0"
            // If string is just name, version is unknown or latest?
            // Shadcn dependencies are usually just names. Version is in package.json?
            // For now assume name.
            return { name: d, version: "latest" }; 
        }) || [],
        item.registryDependencies || [],
        repoId,
        commitId
      );
    }

    return { success: true, commitId };
  }

  /**
   * Ensures a registry package (NPM dependency) exists.
   */
  async ensurePackage(name: string, version: string) {
    const key = `${name}@${version}`;
    const existing = await this.db.query({
      registry_packages: {
        $: { where: { key } },
      },
    });

    if (existing.registry_packages.length > 0) {
      return existing.registry_packages[0].id;
    }

    const pkgId = id();
    await this.db.transact(
      tx.registry_packages[pkgId].update({
        name,
        version,
        key,
      })
    );
    return pkgId;
  }

  /**
   * Creates or updates a component definition and its files.
   */
  async upsertComponent(
    data: {
      name: string;
      type: string;
      title: string;
      description?: string;
      version?: string;
      meta?: any;
      cssVars?: any;
    },
    files: Array<{ path: string; content: string; type: string; target?: string }>,
    dependencies: Array<{ name: string; version: string }>,
    registryDependencies: string[], // names of other components
    repoId: string,
    commitId: string
  ) {
    // 1. Find or Create Component
    const existing = await this.db.query({
      registry_components: {
        $: { where: { name: data.name } },
      },
    });

    const compId = existing.registry_components[0]?.id || id();

    // 2. Prepare Transactions
    const chunks: any[] = [];

    // Component Update
    chunks.push(
      tx.registry_components[compId]
        .update({
          name: data.name,
          type: data.type,
          title: data.title,
          description: data.description,
          version: data.version,
          meta: data.meta,
          cssVars: data.cssVars,
        })
        .link({ repository: repoId })
        .link({ commits: commitId })
    );

    // 3. Handle Packages (Dependencies)
    for (const dep of dependencies) {
      const pkgId = await this.ensurePackage(dep.name, dep.version);
      chunks.push(tx.registry_components[compId].link({ dependencies: pkgId }));
    }

    // 4. Handle Registry Dependencies
    for (const depName of registryDependencies) {
       const depQuery = await this.db.query({
        registry_components: {
          $: { where: { name: depName } },
        },
      });
      const depComp = depQuery.registry_components[0];
      if (depComp) {
        chunks.push(tx.registry_components[compId].link({ registryDependencies: depComp.id }));
      }
    }

    // 5. Handle Files (Upload to Storage & Link)
    for (const file of files) {
      const storagePath = `registry/${repoId}/${commitId}/${file.path}`;
      const buffer = Buffer.from(file.content, 'utf-8');
      
      // Upload to Storage
      let storageId: string | undefined;

      if (!this.db.storage) {
        throw new Error("InstantDB Storage API not available on Admin SDK instance");
      }

      const { data: storageData } = await this.db.storage.uploadFile(storagePath, buffer);
      storageId = storageData.id;

      // Create metadata entity `registry_files`
      const regFileId = id();
      const fileTx = tx.registry_files[regFileId].update({
          path: file.path,
          type: file.type,
          target: file.target,
        }).link({ component: compId });
        
      if (storageId) {
        // Link to storage ($files)
        // Note: admin sdk might not have types for $files link if not in schema interface properly
        // but tx link works with entity names.
        // We use 'storage' link name defined in schema.
        fileTx.link({ storage: storageId });
      }

      chunks.push(fileTx);
    }

    await this.db.transact(chunks);
    
    return compId;
  }
}
