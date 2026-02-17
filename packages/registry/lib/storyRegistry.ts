import { testStory } from "./stories/test.story"
import type { ThreadInstance } from "@ekairos/thread"

const registry = new Map<string, ThreadInstance<any, any>>()

// Register known stories
registry.set("test-story", testStory)

export function getStory(key: string) {
  return registry.get(key)
}


