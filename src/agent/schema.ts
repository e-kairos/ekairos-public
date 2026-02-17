import { i } from "@instantdb/core";
import { domain } from "../domain";

const entities = {
  agent_contexts: i.entity({
    createdAt: i.date(),
    updatedAt: i.date().optional(),
    type: i.string().optional(),
    key: i.string().optional().indexed().unique(),
    status: i.string().optional().indexed(), // open | executing
    content: i.any().optional(),
  }),
  agent_events: i.entity({
    channel: i.string().indexed(),
    createdAt: i.date().indexed(),
    type: i.string().optional().indexed(),
    content: i.any().optional(),
    status: i.string().optional().indexed(),
  }),
  agent_executions: i.entity({
    createdAt: i.date(),
    updatedAt: i.date().optional(),
    status: i.string().optional().indexed(), // executing | completed | failed
  }),
} as const;

const links = {
  agentContextsOrganization: {
    forward: { on: "agent_contexts", has: "one", label: "organization" },
    reverse: { on: "organizations", has: "many", label: "agent_contexts" },
  },
  agentEventsOrganization: {
    forward: { on: "agent_events", has: "one", label: "organization" },
    reverse: { on: "organizations", has: "many", label: "agent_events" },
  },
  agentEventsContext: {
    forward: { on: "agent_events", has: "one", label: "context" },
    reverse: { on: "agent_contexts", has: "many", label: "events" },
  },
  // Executions belong to a context
  agentExecutionsContext: {
    forward: { on: "agent_executions", has: "one", label: "context" },
    reverse: { on: "agent_contexts", has: "many", label: "executions" },
  },
  // Current execution pointer on a context
  agentContextsCurrentExecution: {
    forward: { on: "agent_contexts", has: "one", label: "currentExecution" },
    reverse: { on: "agent_executions", has: "one", label: "currentOf" },
  },
  // Link execution to its trigger event
  agentExecutionsTrigger: {
    forward: { on: "agent_executions", has: "one", label: "trigger" },
    reverse: { on: "agent_events", has: "many", label: "executionsAsTrigger" },
  },
  // Link execution to its reaction event
  agentExecutionsReaction: {
    forward: { on: "agent_executions", has: "one", label: "reaction" },
    reverse: { on: "agent_events", has: "many", label: "executionsAsReaction" },
  },
} as const;

const rooms = {} as const;

export const agentDomain = domain({ entities, links, rooms });



