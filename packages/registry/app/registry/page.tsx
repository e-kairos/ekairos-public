"use client";

import { useEffect, useState } from "react";
import { useUser, useOrganization } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

type Repo = { id: string; url: string; name?: string; lastSyncedAt?: number };
type GitRepo = { id: number; full_name: string; html_url: string; name: string };

const PLATFORM_BASE_URL =
  process.env.NEXT_PUBLIC_PLATFORM_BASE_URL || "http://localhost:3000";

export default function RegistryListPage() {
  const [data, setData] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [gitRepos, setGitRepos] = useState<GitRepo[] | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [creating, setCreating] = useState<number | null>(null); // repo id being created
  const { user } = useUser();
  const { organization } = useOrganization();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/internal/registry");
        if (!res.ok) {
          setStatus(res.status);
          setError(`HTTP ${res.status}`);
          return;
        }
        const json = await res.json();
        setData(json);
      } catch (e: any) {
        setError(e.message || "Error");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const loadRepos = async () => {
      try {
        const res = await fetch("/api/internal/integration/github/repos");
        if (!res.ok) {
          const msg = await res.json().catch(() => null);
          setGitError(msg?.error ? `${res.status} - ${msg.error}` : `Repos HTTP ${res.status}`);
          return;
        }
        const json = await res.json();
        setGitRepos(json);
      } catch (e: any) {
        setGitError(e.message || "Error");
      }
    };
    loadRepos();
  }, []);

  const handleSelectRepo = async (repo: GitRepo) => {
    if (creating) return;
    setCreating(repo.id);
    try {
      const res = await fetch("/api/internal/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repo.html_url, name: repo.name }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const newRepo = await res.json();
      setData((prev) => [newRepo, ...prev.filter((r) => r.id !== newRepo.id)]);
    } catch (e: any) {
      alert(e.message || "Error al crear registry");
    } finally {
      setCreating(null);
    }
  };

  // Check if a GitHub repo already has a registry
  const isRepoLinked = (ghRepo: GitRepo) => {
    return data.some((r) => r.url === ghRepo.html_url);
  };

  const ekairosIntegrationsUrl = `${PLATFORM_BASE_URL}/platform/integrations/github?returnUrl=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin + "/registry" : "/registry",
  )}`;

  if (loading) return <div className="p-6">Cargando registros...</div>;

  if (error || status === 401 || status === 403) {
    const target =
      status === 401 ? `${PLATFORM_BASE_URL}/sign-in` : `${PLATFORM_BASE_URL}/platform/grant`;
    const label = status === 401 ? "Iniciar sesión" : "Seleccionar organización";
    return (
      <div className="p-6 space-y-3">
        <div className="text-red-500 font-semibold">
          {status === 401
            ? "No has iniciado sesión."
            : status === 403
              ? "No hay organización activa."
              : `Error: ${error}`}
        </div>
        <button
          className="rounded bg-blue-600 px-4 py-2 text-white text-sm hover:bg-blue-700"
          onClick={() => {
            if (typeof window !== "undefined") {
              const url = new URL(target);
              url.searchParams.set("redirect", window.location.href);
              window.location.assign(url.toString());
            }
          }}
        >
          {label}
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="rounded border border-gray-200 p-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs text-gray-500">Usuario</div>
          <div className="text-sm font-semibold">
            {user?.primaryEmailAddress?.emailAddress || user?.id || "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Organización activa</div>
          <div className="text-sm font-semibold">
            {organization?.name || "—"} {organization?.id ? `(${organization.id})` : ""}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Registries</h1>
          <p className="text-sm text-gray-600">Selecciona un repositorio para crear un registry.</p>
        </div>
        <a
          className="text-sm text-blue-600 underline"
          href={ekairosIntegrationsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Conectar GitHub en Ekairos
        </a>
      </div>

      {/* GitHub Repos - Selection */}
      <div className="space-y-2 rounded border border-gray-200 p-4">
        <div className="font-semibold">Repositorios GitHub disponibles</div>
        <p className="text-xs text-gray-500">Haz clic en un repositorio para crear un registry.</p>
        
        {gitError && (
          <div className="text-sm text-red-500 space-y-1">
            <div>Error: {gitError}</div>
            <div className="text-xs text-gray-600">
              Si no ves repos, conecta GitHub en la plataforma y vuelve aquí.
            </div>
          </div>
        )}
        {!gitError && !gitRepos && <div className="text-sm text-gray-600">Cargando repos...</div>}
        {!gitError && gitRepos && gitRepos.length === 0 && (
          <div className="text-sm text-gray-600">No se encontraron repos.</div>
        )}
        {!gitError && gitRepos && gitRepos.length > 0 && (
          <div className="grid gap-2 mt-3">
            {gitRepos.map((r) => {
              const linked = isRepoLinked(r);
              const isCreating = creating === r.id;
              return (
                <div
                  key={r.id}
                  className={`flex items-center justify-between rounded border p-3 transition-colors ${
                    linked
                      ? "border-green-300 bg-green-50"
                      : isCreating
                        ? "border-blue-300 bg-blue-50"
                        : "border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer"
                  }`}
                  onClick={() => !linked && !isCreating && handleSelectRepo(r)}
                >
                  <div>
                    <div className="font-medium text-sm">{r.full_name}</div>
                    <div className="text-xs text-gray-500">{r.html_url}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {linked && (
                      <span className="text-xs text-green-600 font-medium">✓ Vinculado</span>
                    )}
                    {isCreating && (
                      <span className="text-xs text-blue-600 font-medium">Creando...</span>
                    )}
                    {!linked && !isCreating && (
                      <button
                        className="rounded bg-blue-600 px-3 py-1 text-white text-xs hover:bg-blue-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectRepo(r);
                        }}
                      >
                        Seleccionar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Existing Registries */}
      {data.length > 0 && (
        <div className="space-y-3">
          <div className="font-semibold">Registries creados</div>
          {data.map((repo) => (
            <div key={repo.id} className="rounded border border-gray-200 p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{repo.name || repo.url}</div>
                <div className="text-xs text-gray-600">{repo.url}</div>
                {repo.lastSyncedAt && (
                  <div className="text-xs text-gray-400">
                    Última sincronización: {new Date(repo.lastSyncedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <a
                className="rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200"
                href={`/registry/${repo.id}`}
              >
                Ver detalles
              </a>
            </div>
          ))}
        </div>
      )}

      {data.length === 0 && !gitError && gitRepos && gitRepos.length > 0 && (
        <div className="text-center text-sm text-gray-500 py-4">
          No hay registries creados. Selecciona un repositorio arriba para empezar.
        </div>
      )}
    </div>
  );
}
