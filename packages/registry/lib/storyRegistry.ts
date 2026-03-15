import { testStory } from "./stories/test.story"
import type { ContextInstance } from "@ekairos/events"

const registry = new Map<string, ContextInstance<any, any>>()

// Register known stories
registry.set("test-story", testStory)

export function getStory(key: string) {
  return registry.get(key)
}


