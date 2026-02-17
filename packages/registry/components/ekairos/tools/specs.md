# Pulzar Tools UI Spec (Generative UI)

## Goal
- Describe how to build and wire UI components for AI SDK 5 tool calls (Generative UI) and how they are rendered by the chat.

## Key Files
- `components/ekairos/tools/tool.tsx`: generic UI building blocks (collapsible wrapper, header with status, input/output helpers).
- `components/ekairos/tools/types.ts`: shared types for tool UI components.
- Chat consumer: `app/platform/components/agent-chat.tsx` (renders tool parts with/without custom components).

## Contract for UI Tool Components
A UI Tool Component renders the result of a tool call and can provide a semantic title for its header.

- Export a default React component typed as `ToolComponentType<InputProps, OutputProps>` from `@/components/ekairos/tools/types`.
- Optionally define static metadata `meta = { title: string }` used as the semantic label.
- Avoid outer borders/wrappers to prevent double borders; the chat UI provides the container.

Example:

```tsx
import type { ToolComponentType } from "@/components/ekairos/tools/types"

type WeatherOutput = { temperature: number; weather: string; location: string }

const WeatherTool: ToolComponentType<never, WeatherOutput> = ({ output }) => {
  const { temperature, weather, location } = output
  return (
    <div className="text-sm">
      <div className="font-semibold mb-1">Current Weather</div>
      <div className="opacity-70 mb-2">{location}</div>
      <div className="flex items-center gap-4">
        <div className="text-2xl font-bold">{temperature}°C</div>
        <div className="text-base">{weather}</div>
      </div>
    </div>
  )
}

WeatherTool.meta = { title: "Weather" }

export default WeatherTool
```

## Rendering Behavior in Chat
- If a custom component is registered for a tool name, AgentChat renders it directly inside a bordered card with compact padding. Parameters and running state are hidden. A semantic label (from `meta.title`) is shown at the bottom-right.
- If no component is registered, AgentChat falls back to a generic collapsible that shows parameters, status, and JSON output.

References:
```app/platform/components/agent-chat.tsx
// custom component branch: direct render, bottom-right label, no params
```

## Server Tool + API Wiring
1) Implement the server tool under `lib/ai/tools/<name>.ts` using `tool()` from `ai`.
2) Register it in your route `tools` map so the model can call it.

References:
```lib/ai/tools/weather.ts
export const displayWeatherTool = tool({ /* ... */ })
```

```app/api/chat/route.ts
// tools: { displayWeather: displayWeatherTool }
```

## UI Wiring
Pass the UI component mapping (tool name → component) to the chat UI.

Reference:
```app/platform/page.tsx
<AgentChat toolComponents={{ displayWeather: WeatherTool }} />
```

## Naming & Placement
- Server tool file: `lib/ai/tools/<tool>.ts`.
- UI component: `components/tools/<tool>/<tool>-tool.tsx` typed as `ToolComponentType<InputProps, OutputProps>`.
- Registration: pass `{ <toolNameInAPI>: <UIComponent> }` to `AgentChat.toolComponents`.

## Acceptance (DoD)
- Custom component renders directly (no expand/collapse), shows semantic label bottom-right, and does not display input parameters.
- Generic fallback shows parameters, running state, and output as JSON.
- No double borders; paddings consistent with the design system.

## PowerShell Scaffolding
Use this snippet to scaffold a new tool UI component (adjust names):

```powershell
# Create UI folder and component
ni components/tools/mytool -ItemType Directory; ni components/tools/mytool/mytool-tool.tsx -ItemType File; Set-Content components/tools/mytool/mytool-tool.tsx "`n`""use client""`n`nimport * as React from \"react\"`nimport type { ToolComponentType } from \"@/components/ekairos/tools/types\"`n`nexport type MyToolOutput = { /* fill with tool output props */ }`n`nconst MyTool: ToolComponentType<MyToolOutput> = (props) => {`n  return (`n    <div className=\"text-sm\">`n      <div className=\"font-semibold mb-1\">My Tool</div>`n      <pre className=\"text-xs bg-muted/50 p-2 rounded\">{JSON.stringify(props, null, 2)}</pre>`n    </div>`n  )`n}`n`nMyTool.meta = { title: \"My Tool\" }`n`nexport default MyTool`n";
```

