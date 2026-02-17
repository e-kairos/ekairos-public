import { storySmoke } from "./story-smoke.story";
import type { ContextEvent } from "@ekairos/thread";

export async function storySmokeWorkflow(params: { env: { orgId: string } }) {
  "use workflow";

  const triggerEvent: ContextEvent = {
    id: `evt_${Date.now()}`,
    type: "user.message",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text: "ping" }],
    },
  };

  return await storySmoke.react(triggerEvent, {
    env: params.env,
    context: null,
    options: {
      maxIterations: 1,
      maxModelSteps: 1,
    },
  });
}
