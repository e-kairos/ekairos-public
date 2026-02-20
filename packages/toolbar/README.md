# @ekairos/toolbar

Lightweight visual feedback toolbar for selecting UI elements, collecting annotations, and exporting structured feedback.

## Install

```bash
pnpm add @ekairos/toolbar
```

## Usage

```tsx
import { EkairosToolbar } from "@ekairos/toolbar";

export function App() {
  return (
    <>
      <YourApp />
      <EkairosToolbar />
    </>
  );
}
```

## Included

- Single element selection
- Multi-select by `Cmd/Ctrl + Shift + Click`
- Drag multi-select and area selection
- Feedback dialog (add/edit/delete)
- Stable selector extraction (`stableSelector`) plus readable path (`elementPath`)
- Markdown output generation and copy/send callbacks

## Keyboard

- `Cmd/Ctrl + Shift + F`: toggle feedback mode
- `Esc`: cancel current interaction / close
- `C`: copy output
- `S`: send output callback
- `X`: clear annotations
- `H`: show/hide markers

