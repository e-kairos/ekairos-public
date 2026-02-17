import type { RegistryItem } from "shadcn/schema";
import { getRegistry } from "@/app/[component]/route";
import { InstallInstructions } from "@/app/install-instructions";
import { ComponentInstallCommands } from "@/app/component-install-commands";

export default async function HomePage() {
  const registry = await getRegistry();
  const allItems = (registry?.items ?? []) as RegistryItem[];

  // Hide internal building blocks such as ai-elements and nested ekairos helpers.
  const items = allItems.filter((item) => {
    if (item.name.startsWith("ai-elements-")) return false;
    if (item.name.startsWith("ekairos-prompt-")) return false;
    if (item.name.startsWith("ekairos-tools-")) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-1.5">
          <p className="text-[0.65rem] tracking-[0.35em] uppercase text-muted-foreground">
            Ekairos Registry
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Componentes listos para usar
          </h1>
          <p className="text-sm text-muted-foreground">
            Bloques AI-first seleccionados para lanzar más rápido.
          </p>
        </div>

        <InstallInstructions />

        <div className="rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="divide-y divide-border/70">
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No hay componentes disponibles en el registry.
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.name}
                  className="flex flex-col gap-2 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex-1 text-sm font-medium truncate text-foreground">
                      {item.title}
                    </span>
                    <span className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
                      @ekairos/{item.name}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {item.description}
                  </p>
                  <ComponentInstallCommands componentName={item.name} />
                </div>
              ))
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {items.length} componentes disponibles
        </p>
      </div>
    </div>
  );
}
