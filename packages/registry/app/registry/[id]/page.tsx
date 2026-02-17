"use client";

import { useEffect, useState } from "react";

type RegistryFile = {
  path: string;
  type?: string;
  target?: string;
  storage?: { url?: string };
};

type RegistryComponent = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  version?: string;
  dependencies?: { name: string }[];
  registryDependencies?: { name: string }[];
  files?: RegistryFile[];
  commits?: { hash: string; message: string; date: number }[];
};

type RegistryRepo = {
  id: string;
  url: string;
  name?: string;
  components?: RegistryComponent[];
};

const PLATFORM_BASE_URL =
  process.env.NEXT_PUBLIC_PLATFORM_BASE_URL || "http://localhost:3000";

export default function RegistryRepoPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<RegistryRepo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/internal/registry/${params.id}`);
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
  }, [params.id]);

  if (loading) return <div className="p-6">Cargando registry...</div>;

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

  if (!data) return <div className="p-6">Sin datos</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Registry Repo</h1>
        <div className="text-sm text-gray-600">ID: {data.id}</div>
        <div className="text-sm text-gray-600">URL: {data.url}</div>
        <div className="text-sm text-gray-600">Nombre: {data.name || "-"}</div>
      </div>

      <SandboxStatus />

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Componentes</h2>
        {data.components?.length ? (
          data.components.map((comp) => (
            <div key={comp.id} className="rounded border border-gray-200 p-4">
              <div className="font-semibold">{comp.title || comp.name}</div>
              <div className="text-sm text-gray-600">{comp.description}</div>
              <div className="text-xs text-gray-500">Versión: {comp.version || "-"}</div>
              <div className="mt-2 text-xs text-gray-700">
                Dependencias: {comp.dependencies?.map((d) => d.name).join(", ") || "-"}
              </div>
              <div className="mt-1 text-xs text-gray-700">
                Registry Deps: {comp.registryDependencies?.map((d) => d.name).join(", ") || "-"}
              </div>
              <div className="mt-3">
                <div className="font-semibold text-sm">Archivos</div>
                <ul className="text-xs text-gray-700 space-y-1 mt-1">
                  {comp.files?.map((f, idx) => (
                    <li key={idx}>
                      <span className="font-mono">{f.path}</span>
                      {f.storage?.url && (
                        <a className="ml-2 text-blue-600" href={f.storage.url} target="_blank" rel="noreferrer">
                          Ver
                        </a>
                      )}
                    </li>
                  )) || <li>Sin archivos</li>}
                </ul>
              </div>
              <div className="mt-3">
                <div className="font-semibold text-sm">Commits</div>
                <ul className="text-xs text-gray-700 space-y-1 mt-1">
                  {comp.commits?.map((c, idx) => (
                    <li key={idx} className="font-mono">
                      {c.hash?.slice(0, 7)} - {c.message}
                    </li>
                  )) || <li>Sin commits recientes</li>}
                </ul>
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-600">No hay componentes sincronizados.</div>
        )}
      </div>
    </div>
  );
}

function SandboxStatus() {
  // Placeholder: en una implementación real, se consultaría el estado del sandbox asociado
  return (
    <div className="rounded border border-gray-200 p-4">
      <div className="font-semibold">Sandbox</div>
      <div className="text-sm text-gray-600">Estado: no inicializado (placeholder)</div>
    </div>
  );
}


