# ekairos

Convenience package that re-exports the main Ekairos surfaces.

## Main entrypoints

- `ekairos` -> `@ekairos/events` + `@ekairos/domain`
- `ekairos/context` -> context runtime/builder surface
- `ekairos/dataset`
- `ekairos/domain`

## Example

```ts
import { createContext } from "ekairos/context";

const demoContext = createContext("demo")
  .context((stored) => stored.content ?? {})
  .narrative(() => "Demo context")
  .actions(() => ({}))
  .build();
```
