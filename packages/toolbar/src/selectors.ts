const TEST_ID_ATTRS = [
  "data-ekairos-id",
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "data-automation-id",
];

function getParentElementCrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return null;
}

function escapeCssValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function isUniqueSelector(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function getMeaningfulClassList(element: HTMLElement): string[] {
  return Array.from(element.classList)
    .map((cls) => cls.trim())
    .filter((cls) => cls.length > 2)
    .filter((cls) => !/^[a-z]{1,2}$/.test(cls))
    .filter((cls) => !/[A-Z0-9]{6,}/.test(cls));
}

function getNthOfTypeIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  );
  return sameTagSiblings.indexOf(element) + 1;
}

export function deepElementFromPoint(x: number, y: number): HTMLElement | null {
  let current = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!current) return null;

  while (current.shadowRoot) {
    const deeper = current.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
    if (!deeper || deeper === current) break;
    current = deeper;
  }
  return current;
}

export function closestCrossingShadow(
  element: Element,
  selector: string,
): Element | null {
  let current: Element | null = element;
  while (current) {
    if (current.matches(selector)) return current;
    current = getParentElementCrossShadow(current);
  }
  return null;
}

export function isElementFixed(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const position = window.getComputedStyle(current).position;
    if (position === "fixed" || position === "sticky") return true;
    current = current.parentElement;
  }
  return false;
}

export function getElementPath(target: HTMLElement, maxDepth = 5): string {
  const parts: string[] = [];
  let current: HTMLElement | null = target;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;

    let segment = tag;
    if (current.id) {
      segment = `#${current.id}`;
    } else {
      const classes = getMeaningfulClassList(current);
      if (classes.length > 0) {
        segment = `${tag}.${classes[0]}`;
      }
    }

    parts.unshift(segment);
    current = getParentElementCrossShadow(current) as HTMLElement | null;
    depth += 1;
  }

  return parts.join(" > ");
}

export function getStableSelector(target: HTMLElement): string {
  for (const attr of TEST_ID_ATTRS) {
    const value = target.getAttribute(attr);
    if (!value) continue;
    const raw = `[${attr}="${escapeCssValue(value)}"]`;
    if (isUniqueSelector(raw)) return raw;
    const tagged = `${target.tagName.toLowerCase()}${raw}`;
    if (isUniqueSelector(tagged)) return tagged;
  }

  if (target.id) {
    const idSelector = `#${escapeCssValue(target.id)}`;
    if (isUniqueSelector(idSelector)) return idSelector;
  }

  const tag = target.tagName.toLowerCase();
  const classes = getMeaningfulClassList(target);
  for (let i = 0; i < Math.min(classes.length, 3); i += 1) {
    const classSelector = `${tag}.${classes.slice(0, i + 1).join(".")}`;
    if (isUniqueSelector(classSelector)) return classSelector;
  }

  const chain: string[] = [];
  let current: HTMLElement | null = target;
  let guard = 0;
  while (current && current.tagName.toLowerCase() !== "html" && guard < 8) {
    const currentTag = current.tagName.toLowerCase();
    const currentClasses = getMeaningfulClassList(current);
    let segment = currentTag;

    if (current.id) {
      const idSelector = `#${escapeCssValue(current.id)}`;
      chain.unshift(idSelector);
      const joined = chain.join(" > ");
      if (isUniqueSelector(joined)) return joined;
      current = getParentElementCrossShadow(current) as HTMLElement | null;
      guard += 1;
      continue;
    }

    if (currentClasses.length > 0) {
      segment = `${currentTag}.${currentClasses[0]}`;
    }

    const index = getNthOfTypeIndex(current);
    segment = `${segment}:nth-of-type(${index})`;
    chain.unshift(segment);
    const candidate = chain.join(" > ");
    if (isUniqueSelector(candidate)) return candidate;

    current = getParentElementCrossShadow(current) as HTMLElement | null;
    guard += 1;
  }

  return `${tag}:nth-of-type(${getNthOfTypeIndex(target)})`;
}

export function identifyElementName(target: HTMLElement): string {
  if (target.dataset.ekairosLabel) return target.dataset.ekairosLabel;

  const tag = target.tagName.toLowerCase();
  const text = target.textContent?.trim() ?? "";
  const shortText = text.slice(0, 40);

  if (tag === "button") {
    const ariaLabel = target.getAttribute("aria-label");
    if (ariaLabel) return `button [${ariaLabel}]`;
    if (shortText) return `button "${shortText}"`;
    return "button";
  }

  if (tag === "a") {
    if (shortText) return `link "${shortText}"`;
    const href = target.getAttribute("href");
    if (href) return `link (${href.slice(0, 60)})`;
    return "link";
  }

  if (tag === "input" || tag === "textarea" || tag === "select") {
    const name = target.getAttribute("name");
    const placeholder = target.getAttribute("placeholder");
    if (placeholder) return `${tag} "${placeholder.slice(0, 30)}"`;
    if (name) return `${tag} [${name}]`;
    return tag;
  }

  if (/^h[1-6]$/.test(tag)) {
    if (shortText) return `${tag} "${shortText}"`;
    return tag;
  }

  if (shortText && shortText.length <= 30) return `"${shortText}"`;
  return tag;
}

export function getElementClasses(target: HTMLElement): string {
  const classes = Array.from(target.classList)
    .map((value) => value.trim())
    .filter(Boolean);
  return classes.join(", ");
}

export function getNearbyText(target: HTMLElement): string {
  const pieces: string[] = [];
  const currentText = target.textContent?.trim();
  if (currentText && currentText.length <= 120) {
    pieces.push(currentText);
  }

  const prevText = target.previousElementSibling?.textContent?.trim();
  if (prevText && prevText.length <= 60) {
    pieces.unshift(`[before "${prevText.slice(0, 50)}"]`);
  }

  const nextText = target.nextElementSibling?.textContent?.trim();
  if (nextText && nextText.length <= 60) {
    pieces.push(`[after "${nextText.slice(0, 50)}"]`);
  }

  return pieces.join(" ");
}

