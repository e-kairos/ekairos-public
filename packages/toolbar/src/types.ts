export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ToolbarAnnotation = {
  id: string;
  timestamp: number;
  x: number;
  y: number;
  comment: string;
  element: string;
  elementPath: string;
  stableSelector?: string;
  selectedText?: string;
  boundingBox?: BoundingBox;
  elementBoundingBoxes?: BoundingBox[];
  cssClasses?: string;
  nearbyText?: string;
  isMultiSelect?: boolean;
  isFixed?: boolean;
};

export type OutputDetailLevel = "compact" | "standard" | "detailed";

export type ToolbarSelectionSnapshot = {
  x: number;
  y: number;
  clientY: number;
  element: string;
  elementPath: string;
  stableSelector?: string;
  selectedText?: string;
  boundingBox?: BoundingBox;
  elementBoundingBoxes?: BoundingBox[];
  cssClasses?: string;
  nearbyText?: string;
  isMultiSelect?: boolean;
  isFixed?: boolean;
  targetElement?: HTMLElement;
  targetElements?: HTMLElement[];
};

export type EkairosToolbarProps = {
  onAnnotationAdd?: (annotation: ToolbarAnnotation) => void;
  onAnnotationUpdate?: (annotation: ToolbarAnnotation) => void;
  onAnnotationDelete?: (annotation: ToolbarAnnotation) => void;
  onAnnotationsClear?: (annotations: ToolbarAnnotation[]) => void;
  onCopy?: (markdown: string) => void;
  onSubmit?: (output: string, annotations: ToolbarAnnotation[]) => void;
  copyToClipboard?: boolean;
  blockInteractions?: boolean;
  initialActive?: boolean;
  outputDetail?: OutputDetailLevel;
  storageKey?: string;
};

