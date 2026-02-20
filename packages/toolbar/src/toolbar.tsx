import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ToolbarPopup, type ToolbarPopupHandle } from "./popup";
import { generateToolbarOutput } from "./output";
import {
  closestCrossingShadow,
  deepElementFromPoint,
  getElementClasses,
  getElementPath,
  getNearbyText,
  getStableSelector,
  identifyElementName,
  isElementFixed,
} from "./selectors";
import type {
  BoundingBox,
  EkairosToolbarProps,
  OutputDetailLevel,
  ToolbarAnnotation,
  ToolbarSelectionSnapshot,
} from "./types";

type PendingMultiSelection = {
  element: HTMLElement;
  rect: DOMRect;
  name: string;
  path: string;
  stableSelector: string;
};

type DragRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const DEFAULT_ACCENT = "#2f7bf6";
const MULTI_ACCENT = "#2fbf71";
const ROOT_ATTR = "[data-ekairos-toolbar-root]";
const MARKER_ATTR = "[data-ekairos-toolbar-marker]";
const POPUP_ATTR = "[data-ekairos-toolbar-popup]";

function intersects(rect: DOMRect, area: DragRect): boolean {
  return (
    rect.left < area.left + area.width &&
    rect.right > area.left &&
    rect.top < area.top + area.height &&
    rect.bottom > area.top
  );
}

function getViewportY(annotation: ToolbarAnnotation, scrollY: number): number {
  return annotation.isFixed ? annotation.y : annotation.y - scrollY;
}

function getPopupPosition(
  xPercent: number,
  y: number,
  isFixed: boolean | undefined,
  scrollY: number,
): CSSProperties {
  const markerY = isFixed ? y : y - scrollY;
  const xPx = (xPercent / 100) * window.innerWidth;
  const clampedX = Math.max(180, Math.min(window.innerWidth - 180, xPx));
  const nearBottom = markerY > window.innerHeight - 280;
  return {
    left: clampedX,
    ...(nearBottom
      ? { bottom: window.innerHeight - markerY + 18 }
      : { top: markerY + 18 }),
  };
}

function detectElementsInDragArea(rect: DragRect): HTMLElement[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "img",
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "label",
        "[role='button']",
        "[data-testid]",
      ].join(","),
    ),
  ).filter((element) => !closestCrossingShadow(element, ROOT_ATTR));

  const selected = candidates
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect: box }) => box.width >= 10 && box.height >= 10)
    .filter(({ rect: box }) => intersects(box, rect));

  return selected
    .filter(
      ({ element }) =>
        !selected.some(
          ({ element: other }) => other !== element && element.contains(other),
        ),
    )
    .map(({ element }) => element);
}

export function EkairosToolbar({
  onAnnotationAdd,
  onAnnotationDelete,
  onAnnotationUpdate,
  onAnnotationsClear,
  onCopy,
  onSubmit,
  copyToClipboard = true,
  blockInteractions = true,
  initialActive = false,
  outputDetail = "standard",
  storageKey,
}: EkairosToolbarProps = {}) {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(initialActive);
  const [annotations, setAnnotations] = useState<ToolbarAnnotation[]>([]);
  const [pending, setPending] = useState<ToolbarSelectionSnapshot | null>(null);
  const [editing, setEditing] = useState<ToolbarAnnotation | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string>("");
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [pendingMulti, setPendingMulti] = useState<PendingMultiSelection[]>([]);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [dragTargets, setDragTargets] = useState<HTMLElement[]>([]);

  const popupRef = useRef<ToolbarPopupHandle>(null);
  const editPopupRef = useRef<ToolbarPopupHandle>(null);
  const pointerRef = useRef<{ start: { x: number; y: number } | null }>({
    start: null,
  });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const modifierRef = useRef({ metaOrCtrl: false, shift: false });

  const pagePath =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : "/";

  const resolvedOutputDetail: OutputDetailLevel = useMemo(() => {
    return outputDetail;
  }, [outputDetail]);

  const resolvedStorageKey = useMemo(() => {
    if (storageKey) return storageKey;
    if (typeof window === "undefined") return "ekairos-toolbar:/";
    return `ekairos-toolbar:${window.location.pathname}`;
  }, [storageKey]);

  const clearTransientState = useCallback(() => {
    setPending(null);
    setEditing(null);
    setHoverRect(null);
    setHoverLabel("");
    setPendingMulti([]);
    setDragRect(null);
    setDragTargets([]);
  }, []);

  const createSnapshotForElement = useCallback(
    (
      element: HTMLElement,
      clientX: number,
      clientY: number,
      selectedText?: string,
    ): ToolbarSelectionSnapshot => {
      const rect = element.getBoundingClientRect();
      const fixed = isElementFixed(element);
      return {
        x: (clientX / window.innerWidth) * 100,
        y: fixed ? clientY : clientY + window.scrollY,
        clientY,
        element: identifyElementName(element),
        elementPath: getElementPath(element),
        stableSelector: getStableSelector(element),
        selectedText,
        boundingBox: {
          x: rect.left,
          y: fixed ? rect.top : rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
        cssClasses: getElementClasses(element),
        nearbyText: getNearbyText(element),
        isFixed: fixed,
        targetElement: element,
      };
    },
    [],
  );

  const createSnapshotFromModifierMulti = useCallback(() => {
    if (pendingMulti.length === 0) return;

    if (pendingMulti.length === 1) {
      const item = pendingMulti[0];
      const centerX = item.rect.left + item.rect.width / 2;
      const centerY = item.rect.top + item.rect.height / 2;
      setPending(createSnapshotForElement(item.element, centerX, centerY));
      setPendingMulti([]);
      return;
    }

    const freshRects = pendingMulti.map((item) => item.element.getBoundingClientRect());
    const lastRect = freshRects[freshRects.length - 1];
    const centerX = lastRect.left + lastRect.width / 2;
    const centerY = lastRect.top + lastRect.height / 2;
    const bounds = freshRects.reduce(
      (acc, rect) => ({
        left: Math.min(acc.left, rect.left),
        top: Math.min(acc.top, rect.top),
        right: Math.max(acc.right, rect.right),
        bottom: Math.max(acc.bottom, rect.bottom),
      }),
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );

    const names = pendingMulti
      .slice(0, 4)
      .map((item) => item.name)
      .join(", ");
    const selectors = pendingMulti
      .slice(0, 6)
      .map((item) => item.stableSelector)
      .join(", ");

    setPending({
      x: (centerX / window.innerWidth) * 100,
      y: centerY + window.scrollY,
      clientY: centerY,
      element: `${pendingMulti.length} elements: ${names}${pendingMulti.length > 4 ? "..." : ""}`,
      elementPath: "multi-select",
      stableSelector: selectors,
      boundingBox: {
        x: bounds.left,
        y: bounds.top + window.scrollY,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      },
      elementBoundingBoxes: freshRects.map((rect) => ({
        x: rect.left,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      })),
      cssClasses: "",
      nearbyText: "",
      isMultiSelect: true,
      targetElements: pendingMulti.map((item) => item.element),
    });
    setPendingMulti([]);
    setHoverRect(null);
  }, [createSnapshotForElement, pendingMulti]);

  const createSnapshotFromDrag = useCallback(
    (elements: HTMLElement[], area: DragRect, releaseX: number, releaseY: number) => {
      if (elements.length === 0) {
        if (area.width > 20 && area.height > 20) {
          setPending({
            x: (releaseX / window.innerWidth) * 100,
            y: releaseY + window.scrollY,
            clientY: releaseY,
            element: "Area selection",
            elementPath: `region (${Math.round(area.left)}, ${Math.round(area.top)})`,
            boundingBox: {
              x: area.left,
              y: area.top + window.scrollY,
              width: area.width,
              height: area.height,
            },
            isMultiSelect: true,
          });
        }
        return;
      }

      if (elements.length === 1) {
        const rect = elements[0].getBoundingClientRect();
        setPending(
          createSnapshotForElement(
            elements[0],
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          ),
        );
        return;
      }

      const rects = elements.map((element) => element.getBoundingClientRect());
      const bounds = rects.reduce(
        (acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      );

      const names = elements
        .slice(0, 4)
        .map((element) => identifyElementName(element))
        .join(", ");

      setPending({
        x: (releaseX / window.innerWidth) * 100,
        y: releaseY + window.scrollY,
        clientY: releaseY,
        element: `${elements.length} elements: ${names}${elements.length > 4 ? "..." : ""}`,
        elementPath: "multi-select",
        stableSelector: elements
          .slice(0, 6)
          .map((element) => getStableSelector(element))
          .join(", "),
        boundingBox: {
          x: bounds.left,
          y: bounds.top + window.scrollY,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        },
        elementBoundingBoxes: rects.map((rect) => ({
          x: rect.left,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        })),
        isMultiSelect: true,
        targetElements: elements,
      });
    },
    [createSnapshotForElement],
  );

  const addAnnotation = useCallback(
    (comment: string) => {
      if (!pending) return;
      const annotation: ToolbarAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        x: pending.x,
        y: pending.y,
        comment,
        element: pending.element,
        elementPath: pending.elementPath,
        stableSelector: pending.stableSelector,
        selectedText: pending.selectedText,
        boundingBox: pending.boundingBox,
        elementBoundingBoxes: pending.elementBoundingBoxes,
        cssClasses: pending.cssClasses,
        nearbyText: pending.nearbyText,
        isMultiSelect: pending.isMultiSelect,
        isFixed: pending.isFixed,
      };

      setAnnotations((prev) => [...prev, annotation]);
      setPending(null);
      onAnnotationAdd?.(annotation);
      window.getSelection()?.removeAllRanges();
    },
    [onAnnotationAdd, pending],
  );

  const updateAnnotation = useCallback(
    (comment: string) => {
      if (!editing) return;
      const updated: ToolbarAnnotation = { ...editing, comment };
      setAnnotations((prev) =>
        prev.map((item) => (item.id === editing.id ? updated : item)),
      );
      setEditing(null);
      onAnnotationUpdate?.(updated);
    },
    [editing, onAnnotationUpdate],
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      const target = annotations.find((annotation) => annotation.id === id);
      setAnnotations((prev) => prev.filter((annotation) => annotation.id !== id));
      setEditing((prev) => (prev?.id === id ? null : prev));
      if (target) onAnnotationDelete?.(target);
    },
    [annotations, onAnnotationDelete],
  );

  const clearAll = useCallback(() => {
    if (annotations.length === 0) return;
    onAnnotationsClear?.(annotations);
    setAnnotations([]);
    setHoveredMarkerId(null);
  }, [annotations, onAnnotationsClear]);

  const copyOutput = useCallback(async () => {
    const output = generateToolbarOutput(annotations, pagePath, resolvedOutputDetail);
    if (!output) return;
    if (copyToClipboard) {
      try {
        await navigator.clipboard.writeText(output);
      } catch {
        // Ignore clipboard failures; callback still receives output.
      }
    }
    onCopy?.(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [annotations, copyToClipboard, onCopy, pagePath, resolvedOutputDetail]);

  const sendOutput = useCallback(() => {
    const output = generateToolbarOutput(annotations, pagePath, resolvedOutputDetail);
    if (!output) return;
    onSubmit?.(output, annotations);
  }, [annotations, onSubmit, pagePath, resolvedOutputDetail]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(resolvedStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ToolbarAnnotation[];
      if (Array.isArray(parsed)) {
        setAnnotations(parsed);
      }
    } catch {
      // Ignore invalid cached state.
    }
  }, [mounted, resolvedStorageKey]);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    try {
      localStorage.setItem(resolvedStorageKey, JSON.stringify(annotations));
    } catch {
      // Ignore storage failures.
    }
  }, [annotations, mounted, resolvedStorageKey]);

  useEffect(() => {
    if (!mounted) return;
    const onScroll = () => setScrollY(window.scrollY);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mounted]);

  useEffect(() => {
    if (!active) {
      clearTransientState();
    }
  }, [active, clearTransientState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setActive((prev) => !prev);
        return;
      }

      if (!active) return;

      if (event.key === "Escape") {
        if (pendingMulti.length > 0) {
          setPendingMulti([]);
          return;
        }
        if (pending) {
          setPending(null);
          return;
        }
        if (editing) {
          setEditing(null);
          return;
        }
        setActive(false);
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key.toLowerCase() === "c" && annotations.length > 0) {
        event.preventDefault();
        void copyOutput();
      }
      if (event.key.toLowerCase() === "s" && annotations.length > 0) {
        event.preventDefault();
        sendOutput();
      }
      if (event.key.toLowerCase() === "x" && annotations.length > 0) {
        event.preventDefault();
        clearAll();
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setShowMarkers((prev) => !prev);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    annotations.length,
    clearAll,
    copyOutput,
    editing,
    pending,
    pendingMulti.length,
    sendOutput,
  ]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        modifierRef.current.metaOrCtrl = true;
      }
      if (event.key === "Shift") modifierRef.current.shift = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const hadBoth = modifierRef.current.metaOrCtrl && modifierRef.current.shift;
      if (event.key === "Meta" || event.key === "Control") {
        modifierRef.current.metaOrCtrl = false;
      }
      if (event.key === "Shift") modifierRef.current.shift = false;
      const hasBoth = modifierRef.current.metaOrCtrl && modifierRef.current.shift;
      if (hadBoth && !hasBoth && pendingMulti.length > 0) {
        createSnapshotFromModifierMulti();
      }
    };
    const onBlur = () => {
      modifierRef.current = { metaOrCtrl: false, shift: false };
      setPendingMulti([]);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active, createSnapshotFromModifierMulti, pendingMulti.length]);

  useEffect(() => {
    if (!active || pending || editing || dragRect) return;
    const onMouseMove = (event: MouseEvent) => {
      const element = deepElementFromPoint(event.clientX, event.clientY);
      if (!element || closestCrossingShadow(element, ROOT_ATTR)) {
        setHoverRect(null);
        setHoverLabel("");
        return;
      }
      const rect = element.getBoundingClientRect();
      setHoverRect(rect);
      setHoverLabel(identifyElementName(element));
      setHoverPosition({ x: event.clientX, y: event.clientY });
    };
    document.addEventListener("mousemove", onMouseMove);
    return () => document.removeEventListener("mousemove", onMouseMove);
  }, [active, dragRect, editing, pending]);

  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      const target = (event.composedPath()[0] || event.target) as HTMLElement;
      if (!target) return;
      if (closestCrossingShadow(target, ROOT_ATTR)) return;
      if (closestCrossingShadow(target, MARKER_ATTR)) return;
      if (closestCrossingShadow(target, POPUP_ATTR)) return;

      if (pending) {
        event.preventDefault();
        popupRef.current?.shake();
        return;
      }
      if (editing) {
        event.preventDefault();
        editPopupRef.current?.shake();
        return;
      }

      const modifierMulti = (event.metaKey || event.ctrlKey) && event.shiftKey;
      const element = deepElementFromPoint(event.clientX, event.clientY);
      if (!element) return;

      if (modifierMulti) {
        event.preventDefault();
        event.stopPropagation();

        const existing = pendingMulti.findIndex((item) => item.element === element);
        if (existing >= 0) {
          setPendingMulti((prev) => prev.filter((_, index) => index !== existing));
        } else {
          const rect = element.getBoundingClientRect();
          setPendingMulti((prev) => [
            ...prev,
            {
              element,
              rect,
              name: identifyElementName(element),
              path: getElementPath(element),
              stableSelector: getStableSelector(element),
            },
          ]);
        }
        return;
      }

      const interactive = closestCrossingShadow(
        target,
        "button, a, input, select, textarea, [role='button'], [onclick]",
      );
      if (blockInteractions && interactive) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        event.preventDefault();
      }

      const selectedText = window.getSelection()?.toString().trim();
      setPending(
        createSnapshotForElement(
          element,
          event.clientX,
          event.clientY,
          selectedText?.slice(0, 500),
        ),
      );
      setHoverRect(null);
      setPendingMulti([]);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [
    active,
    blockInteractions,
    createSnapshotForElement,
    editing,
    pending,
    pendingMulti,
  ]);

  useEffect(() => {
    if (!active || pending || editing) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = (event.composedPath()[0] || event.target) as HTMLElement;
      if (!target) return;
      if (closestCrossingShadow(target, ROOT_ATTR)) return;
      if (closestCrossingShadow(target, POPUP_ATTR)) return;
      if (closestCrossingShadow(target, MARKER_ATTR)) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      pointerRef.current.start = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [active, editing, pending]);

  useEffect(() => {
    if (!active || pending || editing) return;
    const onMouseMove = (event: MouseEvent) => {
      const start = pointerRef.current.start;
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const distance = dx * dx + dy * dy;
      if (!dragStartRef.current && distance < 64) return;

      if (!dragStartRef.current) {
        dragStartRef.current = start;
      }

      const left = Math.min(dragStartRef.current.x, event.clientX);
      const top = Math.min(dragStartRef.current.y, event.clientY);
      const width = Math.abs(event.clientX - dragStartRef.current.x);
      const height = Math.abs(event.clientY - dragStartRef.current.y);
      const rect = { left, top, width, height };
      setDragRect(rect);
      setDragTargets(detectElementsInDragArea(rect));
    };
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMouseMove);
  }, [active, editing, pending]);

  useEffect(() => {
    if (!active) return;
    const onMouseUp = (event: MouseEvent) => {
      const started = dragStartRef.current;
      const currentDrag = dragRect;
      pointerRef.current.start = null;
      dragStartRef.current = null;

      if (!started || !currentDrag) {
        setDragRect(null);
        setDragTargets([]);
        return;
      }

      createSnapshotFromDrag(dragTargets, currentDrag, event.clientX, event.clientY);
      setDragRect(null);
      setDragTargets([]);
      setHoverRect(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [active, createSnapshotFromDrag, dragRect, dragTargets]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        data-ekairos-toolbar-root
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 100010,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: active ? "8px 10px" : 0,
          borderRadius: 999,
          background: active ? "rgba(24,26,32,0.96)" : "transparent",
          border: active ? "1px solid rgba(255,255,255,0.08)" : "none",
          boxShadow: active ? "0 8px 22px rgba(0,0,0,0.35)" : "none",
          color: "#fff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <button
          type="button"
          onClick={() => setActive((prev) => !prev)}
          style={{
            width: 38,
            height: 38,
            border: "none",
            borderRadius: 999,
            cursor: "pointer",
            background: active ? DEFAULT_ACCENT : "rgba(24,26,32,0.96)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          FB
        </button>

        {active ? (
          <>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
              {annotations.length}
            </span>
            <button
              type="button"
              onClick={() => setShowMarkers((prev) => !prev)}
              style={toolbarButtonStyle}
            >
              {showMarkers ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={() => void copyOutput()} style={toolbarButtonStyle}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={sendOutput} style={toolbarButtonStyle}>
              Send
            </button>
            <button type="button" onClick={clearAll} style={toolbarButtonStyle}>
              Clear
            </button>
          </>
        ) : null}
      </div>

      {active ? (
        <div
          data-ekairos-toolbar-root
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            pointerEvents: "none",
          }}
        >
          {hoverRect && !pending && !editing && !dragRect ? (
            <div
              style={{
                position: "fixed",
                left: hoverRect.left,
                top: hoverRect.top,
                width: hoverRect.width,
                height: hoverRect.height,
                border: "2px solid rgba(47,123,246,0.55)",
                background: "rgba(47,123,246,0.08)",
                borderRadius: 4,
                boxSizing: "border-box",
              }}
            />
          ) : null}

          {hoverRect && hoverLabel && !pending && !editing && !dragRect ? (
            <div
              style={{
                position: "fixed",
                left: Math.max(8, Math.min(window.innerWidth - 220, hoverPosition.x + 10)),
                top: Math.max(8, hoverPosition.y - 24),
                maxWidth: 210,
                padding: "4px 7px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.82)",
                color: "#fff",
                fontSize: 11,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {hoverLabel}
            </div>
          ) : null}

          {pendingMulti.map((item, index) => {
            const rect = item.element.getBoundingClientRect();
            return (
              <div
                key={`${item.path}-${index}`}
                style={{
                  position: "fixed",
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  borderRadius: 4,
                  border: `2px dashed ${pendingMulti.length > 1 ? MULTI_ACCENT : DEFAULT_ACCENT}`,
                  background:
                    pendingMulti.length > 1
                      ? "rgba(47,191,113,0.08)"
                      : "rgba(47,123,246,0.08)",
                }}
              />
            );
          })}

          {dragRect ? (
            <div
              style={{
                position: "fixed",
                left: dragRect.left,
                top: dragRect.top,
                width: dragRect.width,
                height: dragRect.height,
                borderRadius: 4,
                border: "2px solid rgba(47,191,113,0.65)",
                background: "rgba(47,191,113,0.1)",
              }}
            />
          ) : null}

          {dragRect
            ? dragTargets.map((element, index) => {
                const rect = element.getBoundingClientRect();
                return (
                  <div
                    key={`${index}-${rect.left}-${rect.top}`}
                    style={{
                      position: "fixed",
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                      borderRadius: 4,
                      border: "2px solid rgba(47,191,113,0.45)",
                      background: "rgba(47,191,113,0.05)",
                    }}
                  />
                );
              })
            : null}

          {showMarkers
            ? annotations.map((annotation, index) => {
                const y = getViewportY(annotation, scrollY);
                if (!annotation.isFixed && (y < -20 || y > window.innerHeight + 20)) {
                  return null;
                }
                const isMulti = !!annotation.isMultiSelect;
                const hovered = hoveredMarkerId === annotation.id;
                return (
                  <div
                    key={annotation.id}
                    data-ekairos-toolbar-marker
                    onMouseEnter={(event) => {
                      event.stopPropagation();
                      setHoveredMarkerId(annotation.id);
                    }}
                    onMouseLeave={(event) => {
                      event.stopPropagation();
                      setHoveredMarkerId((prev) => (prev === annotation.id ? null : prev));
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing(annotation);
                      setPending(null);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditing(annotation);
                      setPending(null);
                    }}
                    style={{
                      position: "fixed",
                      left: `${annotation.x}%`,
                      top: y,
                      transform: "translate(-50%, -50%)",
                      width: isMulti ? 26 : 22,
                      height: isMulti ? 26 : 22,
                      borderRadius: isMulti ? 6 : 999,
                      border: "none",
                      background: isMulti ? MULTI_ACCENT : DEFAULT_ACCENT,
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 3px 8px rgba(0,0,0,0.28)",
                      pointerEvents: "auto",
                    }}
                  >
                    {hovered ? "E" : index + 1}
                  </div>
                );
              })
            : null}

          {hoveredMarkerId && !pending && !editing
            ? (() => {
                const current = annotations.find((annotation) => annotation.id === hoveredMarkerId);
                if (!current) return null;
                if (current.elementBoundingBoxes?.length) {
                  return current.elementBoundingBoxes.map((box, index) => (
                    <div
                      key={`hover-outline-${index}`}
                      style={{
                        position: "fixed",
                        left: box.x,
                        top: box.y - scrollY,
                        width: box.width,
                        height: box.height,
                        border: "2px dashed rgba(47,191,113,0.7)",
                        background: "rgba(47,191,113,0.08)",
                        borderRadius: 4,
                      }}
                    />
                  ));
                }
                if (!current.boundingBox) return null;
                return (
                  <div
                    style={{
                      position: "fixed",
                      left: current.boundingBox.x,
                      top: current.isFixed
                        ? current.boundingBox.y
                        : current.boundingBox.y - scrollY,
                      width: current.boundingBox.width,
                      height: current.boundingBox.height,
                      border: "2px solid rgba(47,123,246,0.7)",
                      background: "rgba(47,123,246,0.08)",
                      borderRadius: 4,
                    }}
                  />
                );
              })()
            : null}

          {pending
            ? (() => {
                const color = pending.isMultiSelect ? MULTI_ACCENT : DEFAULT_ACCENT;
                const markerY = pending.isFixed ? pending.y : pending.y - scrollY;
                const markerX = pending.x;
                const popupPosition = getPopupPosition(
                  markerX,
                  pending.y,
                  pending.isFixed,
                  scrollY,
                );

                return (
                  <>
                    {pending.targetElements?.length
                      ? pending.targetElements
                          .filter((element) => document.contains(element))
                          .map((element, index) => {
                            const rect = element.getBoundingClientRect();
                            return (
                              <div
                                key={`pending-el-${index}`}
                                style={{
                                  position: "fixed",
                                  left: rect.left,
                                  top: rect.top,
                                  width: rect.width,
                                  height: rect.height,
                                  borderRadius: 4,
                                  border: `2px dashed ${MULTI_ACCENT}`,
                                  background: "rgba(47,191,113,0.08)",
                                }}
                              />
                            );
                          })
                      : pending.targetElement && document.contains(pending.targetElement)
                        ? (() => {
                            const rect = pending.targetElement!.getBoundingClientRect();
                            return (
                              <div
                                style={{
                                  position: "fixed",
                                  left: rect.left,
                                  top: rect.top,
                                  width: rect.width,
                                  height: rect.height,
                                  borderRadius: 4,
                                  border: `2px solid ${color}`,
                                  background: "rgba(47,123,246,0.08)",
                                }}
                              />
                            );
                          })()
                        : pending.boundingBox
                          ? (() => {
                              const box = pending.boundingBox!;
                              return (
                                <div
                                  style={{
                                    position: "fixed",
                                    left: box.x,
                                    top: box.y - scrollY,
                                    width: box.width,
                                    height: box.height,
                                    borderRadius: 4,
                                    border: `2px ${pending.isMultiSelect ? "dashed" : "solid"} ${color}`,
                                    background: pending.isMultiSelect
                                      ? "rgba(47,191,113,0.08)"
                                      : "rgba(47,123,246,0.08)",
                                  }}
                                />
                              );
                            })()
                          : null}

                    <div
                      style={{
                        position: "fixed",
                        left: `${markerX}%`,
                        top: markerY,
                        transform: "translate(-50%, -50%)",
                        width: pending.isMultiSelect ? 26 : 22,
                        height: pending.isMultiSelect ? 26 : 22,
                        borderRadius: pending.isMultiSelect ? 6 : 999,
                        background: color,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 14,
                        boxShadow: "0 3px 8px rgba(0,0,0,0.3)",
                      }}
                    >
                      +
                    </div>

                    <ToolbarPopup
                      ref={popupRef}
                      element={pending.element}
                      selectedText={pending.selectedText}
                      placeholder={
                        pending.element === "Area selection"
                          ? "What should change in this area?"
                          : pending.isMultiSelect
                            ? "Feedback for this set of elements..."
                            : "What should change?"
                      }
                      onSubmit={addAnnotation}
                      onCancel={() => setPending(null)}
                      accentColor={color}
                      style={popupPosition}
                    />
                  </>
                );
              })()
            : null}

          {editing
            ? (() => {
                const popupPosition = getPopupPosition(
                  editing.x,
                  editing.y,
                  editing.isFixed,
                  scrollY,
                );
                return (
                  <>
                    {editing.elementBoundingBoxes?.length
                      ? editing.elementBoundingBoxes.map((box, index) => (
                          <div
                            key={`edit-box-${index}`}
                            style={{
                              position: "fixed",
                              left: box.x,
                              top: box.y - scrollY,
                              width: box.width,
                              height: box.height,
                              borderRadius: 4,
                              border: "2px dashed rgba(47,191,113,0.7)",
                              background: "rgba(47,191,113,0.08)",
                            }}
                          />
                        ))
                      : editing.boundingBox
                        ? (() => {
                            const box = editing.boundingBox as BoundingBox;
                            return (
                              <div
                                style={{
                                  position: "fixed",
                                  left: box.x,
                                  top: editing.isFixed ? box.y : box.y - scrollY,
                                  width: box.width,
                                  height: box.height,
                                  borderRadius: 4,
                                  border: `2px ${editing.isMultiSelect ? "dashed" : "solid"} ${
                                    editing.isMultiSelect ? MULTI_ACCENT : DEFAULT_ACCENT
                                  }`,
                                  background: editing.isMultiSelect
                                    ? "rgba(47,191,113,0.08)"
                                    : "rgba(47,123,246,0.08)",
                                }}
                              />
                            );
                          })()
                        : null}

                    <ToolbarPopup
                      ref={editPopupRef}
                      element={editing.element}
                      selectedText={editing.selectedText}
                      initialValue={editing.comment}
                      submitLabel="Save"
                      onSubmit={updateAnnotation}
                      onCancel={() => setEditing(null)}
                      onDelete={() => deleteAnnotation(editing.id)}
                      accentColor={editing.isMultiSelect ? MULTI_ACCENT : DEFAULT_ACCENT}
                      style={popupPosition}
                    />
                  </>
                );
              })()
            : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
}

const toolbarButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 999,
  background: "transparent",
  color: "rgba(255,255,255,0.92)",
  fontSize: 12,
  lineHeight: 1,
  cursor: "pointer",
  padding: "6px 10px",
};
