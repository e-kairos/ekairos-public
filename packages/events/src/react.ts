"use client";

export { mergeContextStepPartsForUI, useContext } from "./react.use-context";

export type {
  AppendArgs,
  ContextEventForUI,
  ContextFirstLevel,
  ContextStepForUI,
  ContextStepRuntime,
  ContextStepStreamInfo,
  ContextStepStreamReaderInfo,
  ContextStatus,
  ContextValue,
  ReasoningLevel,
  SendStatus,
  UseContextArgs,
  UseContextOptions,
  UseContextState,
  UseContextStateHook,
} from "./react.types";

export { ASSISTANT_MESSAGE_TYPE, INPUT_TEXT_ITEM_TYPE } from "./react.types";

export {
  findNormalizedToolPart,
  getActionPartInfo,
  getCreateMessageText,
  getPartText,
  getReasoningState,
  getReasoningText,
  getSourceParts,
  normalizeContextEventParts,
} from "./react.context-event-parts";

export type { ContextActionPartInfo } from "./react.context-event-parts";

export {
  buildContextStepViews,
  buildEventStepsIndex,
  buildLiveEventFromStepChunks,
  consumePersistedContextStepStream,
  extractPersistedContextTree,
  isUserEvent,
} from "./react.step-stream";

export type { PersistedContextTree } from "./react.step-stream";
