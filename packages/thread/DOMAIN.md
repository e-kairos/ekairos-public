# domain: story
Type: core
Focus: durable AI stories and persistence

## Overview
Story is the durable agent orchestration domain. It stores contexts, events, executions,
and steps for LLM loops with workflow-friendly determinism.

## Navigation
- packages/story/src/schema.ts - story domain schema (InstantDB)
- packages/story/src/story.engine.ts - core engine + react loop
- packages/story/src/story.builder.ts - createStory / builder API
- packages/story/src/story.config.ts - runtime resolver + store wiring
- packages/story/src/stores/instant.store.ts - InstantStore adapter
- module: @ekairos/thread (exports story, createStory, threadDomain)

## Responsibilities
- Persist story contexts, events, executions, steps, and parts.
- Provide a deterministic react loop for workflows.
- Convert events to model messages and tool calls.
- Expose story builder and registry APIs.

## Entities
- thread_contexts: Story contexts (state + metadata).
- thread_items: Stored events and message parts.
- story_executions: Execution runs for a story context.
- story_steps: Step records for each loop iteration.
- story_parts: Normalized parts produced by steps.
- document_documents: Attached documents and processed content.

