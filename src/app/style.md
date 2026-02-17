## Brand North Star

- **Positioning**: Agent-native software studio focused on high-leverage engineering automation.
- **Voice**: Confident, terse, technical; communicate outcomes in brief fragments.
- **Mood**: Futuristic, high-contrast, cinematic darkness punctuated by neon ember accents.

## Typography

- **Heading family**: `Space Grotesk`, 600 weight, tight letter spacing (-0.02em).
- **Body family**: `Inter`, 400 weight, relaxed letter spacing (0em).
- **Monospace callouts**: `IBM Plex Mono`, 500 weight for CLI snippets.
- **Scale**:
  - Display: clamp(2.75rem, 6vw, 4.5rem)
  - Eyebrow / microcopy: 0.75rem uppercase, 500 weight
  - Body: 1rem–1.125rem, 150% line height

### CSS Snippet

```css
:root {
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", SFMono-Regular, monospace;
}
```

## Color System

| Token | Hex | Usage |
| --- | --- | --- |
| `--color-bg` | #030304 | Global background |
| `--color-surface` | #0A0A0F | Cards, panels |
| `--color-contrast` | #F4F4F6 | Primary text |
| `--color-muted` | #9EA0AA | Secondary text |
| `--color-border` | #1F1F26 | Hairline separators |
| `--color-accent` | #FF5C1B | Primary CTA + key points |
| `--color-accent-soft` | rgba(255, 92, 27, 0.2) | Glows, pills |
| `--color-grid` | #2D2E34 | Dotted grid / timeline strokes |

- Gradients: `linear-gradient(120deg, rgba(255,92,27,0.45), rgba(255,92,27,0))`.
- Glows: large blur (120px) with low opacity accent to create ember effect.

## Layout Principles

- **Stage width**: 1200px max, content centered with 3rem horizontal padding.
- **Vertical rhythm**: Sections separated by 6rem; hero occupies 90vh.
- **Grid**: Use 12-column CSS grid; keep content anchored left while visuals float right for hero.
- **Motion hint**: Use dotted timelines, diagonal strokes, and slider stacks to mimic Factory.ai feel.

## Geometry & Detailing

- **Edges**: Keep radii tight (0–10px). Prefer bevels or clipped corners over pills.
- **Motifs**: Use angled dividers, diagonal accents, and diamond markers instead of circles.
- **Buttons**: Rectilinear with hard edges; accent them with inset glows or border-left bars.
- **Badges**: Inline tags with a short accent rule (`border-left: 4px solid var(--color-accent)`) instead of rounded pills.
- **Data nodes**: Represent timelines with rotated squares (45°) to feel kinetic.

## Components

### Hero

- Eyebrow tag `VISION`.
- Display headline `Agent-Native Software Development`.
- Subtext limited to ~2 sentences.
- Action row: OS segmented control (MacOS/Linux vs Windows) + CLI command pill with copy icon.
- Background details: dotted slider stack with highlighted orange nodes + faint grid lines (use CSS pseudo-elements).

### Feature Rows

- Three cards describing automation capabilities (IDE, CI/CD, Incidents).
- Each card: eyebrow, title, short paragraph, angled indicator line instead of circular icon.
- Hover: translateY(-6px) with a linear glow focused on edges.

### Timeline Graphic

- Horizontal dotted lines with nodes representing workflows.
- Use CSS grid and absolute-positioned pseudo elements.

### Trust Logos

- Row of monochrome logos with `mix-blend-mode: screen; opacity: 0.6`.

### CTA Footer

- Split panel with headline + button on the left, subtle dotted background on right.
- Button style: solid accent background, black text, 600 weight, crisp 6px radius with beveled corners.

## Copy Guide

- Speak in fragments: "Delegate refactors, incidents, migrations."
- Highlight benefit-first statements.
- Buttons: `Launch Console`, `Contact Sales`.

## Layout Plan

1. **Hero**: Eyebrow, headline, subtext, command card, slider visual.
2. **Capability Highlights**: Three feature cards in a responsive grid.
3. **Workflow Timeline**: Visual row emphasizing orchestration.
4. **Trust Indicators**: Logo strip.
5. **CTA Footer**: Reinforce action with button pair.

All sections reference the tokens above; implement `globals.css` utility classes as needed but keep structure self-contained within `page.tsx`.

