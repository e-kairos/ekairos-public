"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Dot, GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { useThreadDebugSnapshots } from "./registry";

function shortId(id: string) {
  if (!id) return "";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

type Dock = "bottom" | "top" | "left" | "right";
const DOCK_STORAGE_KEY = "esolbay.thread-debug-footer.dock";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getNearestDock(x: number, y: number, vw: number, vh: number): Dock {
  const anchors: Array<{ dock: Dock; ax: number; ay: number }> = [
    { dock: "top", ax: vw / 2, ay: 0 },
    { dock: "bottom", ax: vw / 2, ay: vh },
    { dock: "left", ax: 0, ay: vh / 2 },
    { dock: "right", ax: vw, ay: vh / 2 },
  ];

  let best: Dock = "bottom";
  let bestD = Number.POSITIVE_INFINITY;
  for (const a of anchors) {
    const dx = x - a.ax;
    const dy = y - a.ay;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = a.dock;
    }
  }
  return best;
}

export function ThreadDebugFooter() {
  const [open, setOpen] = useState(false);
  const snapshots = useThreadDebugSnapshots();
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [dock, setDock] = useState<Dock>("bottom");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

  const summary = useMemo(() => {
    const total = snapshots.length;
    const streaming = snapshots.filter((s) => s.contextStatus === "streaming").length;
    const submitting = snapshots.filter((s) => s.sendStatus === "submitting").length;
    return { total, streaming, submitting };
  }, [snapshots]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDebugEnabled(window.localStorage.getItem("ekairos:debug") === "1");
    } catch {
      setDebugEnabled(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DOCK_STORAGE_KEY);
      if (saved === "bottom" || saved === "top" || saved === "left" || saved === "right") {
        setDock(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const isVerticalDock = dock === "left" || dock === "right";
  const isDragging = !!dragPos;

  const panelPositionClass = useMemo(() => {
    if (isDragging) return "left-0 top-0";
    if (dock === "top") return "left-1/2 top-3 -translate-x-1/2";
    if (dock === "bottom") return "left-1/2 bottom-3 -translate-x-1/2";
    if (dock === "left") return "left-3 top-1/2 -translate-y-1/2";
    return "right-3 top-1/2 -translate-y-1/2";
  }, [dock, isDragging]);

  // IMPORTANT: do not early-return before all hooks; otherwise React detects hook order changes.
  if (!debugEnabled) return null;

  const onDragStart = (e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const rect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setDragPos({
      left: rect.left,
      top: rect.top,
    });
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    if (dragRef.current.pointerId !== e.pointerId) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = panelRef.current;
    const rect = el?.getBoundingClientRect();
    const w = rect?.width ?? 320;
    const h = rect?.height ?? 44;

    const left = clamp(e.clientX - dragRef.current.offsetX, 8, vw - w - 8);
    const top = clamp(e.clientY - dragRef.current.offsetY, 8, vh - h - 8);
    setDragPos({ left, top });
  };

  const onDragEnd = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    if (dragRef.current.pointerId !== e.pointerId) return;

    dragRef.current = null;
    setDragPos(null);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nextDock = getNearestDock(e.clientX, e.clientY, vw, vh);
    setDock(nextDock);
    try {
      localStorage.setItem(DOCK_STORAGE_KEY, nextDock);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <div
        ref={panelRef}
        className={cn(
          "fixed pointer-events-auto",
          "px-0",
          panelPositionClass
        )}
        style={
          dragPos
            ? {
                transform: `translate3d(${Math.round(dragPos.left)}px, ${Math.round(
                  dragPos.top
                )}px, 0)`,
              }
            : undefined
        }
      >
        <div
          className={cn(
            "rounded-xl border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 shadow-sm overflow-hidden",
            isVerticalDock ? "w-[220px]" : "w-[calc(100vw-24px)] max-w-[720px]",
            open ? "max-h-[70vh]" : "max-h-[48px]"
          )}
        >
          <div
            className={cn(
              "w-full flex items-center justify-between gap-3 px-3 py-2 text-xs select-none",
              isVerticalDock ? "flex-col items-stretch gap-2" : ""
            )}
          >
            <div className={cn("flex items-center gap-2 min-w-0", isVerticalDock ? "w-full" : "")}>
              <button
                type="button"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className={cn(
                  "shrink-0 inline-flex items-center justify-center rounded-md border bg-muted/20 text-muted-foreground",
                  "h-7 w-7 cursor-grab active:cursor-grabbing"
                )}
                aria-label="Mover debug"
                title="Mover debug"
              >
                <GripVertical className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                  "flex items-center justify-between gap-3 min-w-0",
                  isVerticalDock ? "w-full" : ""
                )}
              >
                <span className="font-medium">Debug</span>
                {!isVerticalDock && (
                  <span className="text-muted-foreground truncate">
                    Contexts: {summary.total} · streaming: {summary.streaming} · submitting:{" "}
                    {summary.submitting}
                  </span>
                )}
                <span className="text-muted-foreground shrink-0">
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </span>
              </button>
            </div>

            {isVerticalDock && (
              <div className="w-full rounded-lg border bg-muted/10 px-2 py-1.5 text-[11px] text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Contexts</span>
                  <span className="font-medium tabular-nums text-foreground">{summary.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Streaming</span>
                  <span className="font-medium tabular-nums text-foreground">{summary.streaming}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Submitting</span>
                  <span className="font-medium tabular-nums text-foreground">{summary.submitting}</span>
                </div>
              </div>
            )}
          </div>

          {open && (
            <div className="border-t">
              <div className="max-h-[65vh] overflow-auto p-3 space-y-3">
                {snapshots.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No hay instancias de contexts activas en esta pantalla.
                  </div>
                ) : (
                  snapshots.map((s) => (
                    <div key={s.instanceId} className="rounded-lg border bg-muted/10">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Dot
                            className={cn(
                              "h-6 w-6 -ml-2",
                              s.contextStatus === "streaming"
                                ? "text-amber-500"
                                : s.contextStatus === "closed"
                                  ? "text-muted-foreground"
                                  : "text-emerald-500"
                            )}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">
                              {s.apiUrl}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              ctx: {s.contextId ? shortId(String(s.contextId)) : "null"} · events:{" "}
                              {s.events.length}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

