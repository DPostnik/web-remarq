import { getElementToViewportMatrix, hasVisualTransform } from "./transform";

const VIEWPORT_MARGIN = 8;
const TOOLTIP_GAP = 8;
const MARKED_TOOLTIP_GAP = 16;

export class Overlay {
  private overlayEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private target: Element | null = null;
  private highlight = false;
  private tooltipGap = TOOLTIP_GAP;

  constructor(private container: HTMLElement) {
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "remarq-overlay";
    this.overlayEl.style.display = "none";

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "remarq-tooltip";
    this.tooltipEl.style.display = "none";

    container.appendChild(this.overlayEl);
    container.appendChild(this.tooltipEl);
    window.addEventListener("scroll", this.updatePosition, true);
    window.addEventListener("resize", this.updatePosition);
  }

  show(target: Element, highlight: boolean, marked: boolean): void {
    this.target = target;
    this.highlight = highlight;
    this.tooltipEl.textContent = describeElement(target);
    this.tooltipGap = marked ? MARKED_TOOLTIP_GAP : TOOLTIP_GAP;
    this.updatePosition();
  }

  private updatePosition = (): void => {
    const target = this.target;
    if (!target) return;
    if (!target.isConnected) {
      this.hide();
      return;
    }
    try {
      const rect = target.getBoundingClientRect();
      const viewport = document.documentElement;
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewport.clientHeight || rect.left >= viewport.clientWidth) {
        this.overlayEl.style.display = "none";
        this.tooltipEl.style.display = "none";
        return;
      }
      this.overlayEl.style.display = this.highlight ? "block" : "none";
      if (this.highlight) {
        const transformed = target instanceof HTMLElement && hasVisualTransform(target);
        this.overlayEl.style.left = `${transformed ? 0 : rect.left}px`;
        this.overlayEl.style.top = `${transformed ? 0 : rect.top}px`;
        this.overlayEl.style.width = `${transformed ? target.offsetWidth : rect.width}px`;
        this.overlayEl.style.height = `${transformed ? target.offsetHeight : rect.height}px`;
        this.overlayEl.style.transform = transformed ? getElementToViewportMatrix(target).toString() : "";
      }
      this.tooltipEl.style.display = "block";
      this.positionTooltip(rect);
    } catch {
      this.hide();
    }
  };

  hide(): void {
    this.target = null;
    this.overlayEl.style.display = "none";
    this.tooltipEl.style.display = "none";
  }

  destroy(): void {
    window.removeEventListener("scroll", this.updatePosition, true);
    window.removeEventListener("resize", this.updatePosition);
    this.overlayEl.remove();
    this.tooltipEl.remove();
  }

  private positionTooltip(rect: DOMRect): void {
    const gap = this.tooltipGap;
    const tooltipWidth = this.tooltipEl.offsetWidth;
    const tooltipHeight = this.tooltipEl.offsetHeight;

    const maxLeft = document.documentElement.clientWidth - tooltipWidth - VIEWPORT_MARGIN;
    const maxTop = document.documentElement.clientHeight - tooltipHeight - VIEWPORT_MARGIN;
    const clampLeft = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
    const clampTop = Math.max(VIEWPORT_MARGIN, Math.min(rect.top, maxTop));
    const above = rect.top - tooltipHeight - gap;
    const below = rect.bottom + gap;
    const right = rect.right + gap;
    const left = rect.left - tooltipWidth - gap;
    const fits = (value: number, max: number) => value >= VIEWPORT_MARGIN && value <= max;
    const vertical = [
      [clampLeft, above],
      [clampLeft, below],
    ];
    const horizontal = [
      [right, clampTop],
      [left, clampTop],
    ];
    const positions = gap === MARKED_TOOLTIP_GAP ? [...horizontal, ...vertical] : [...vertical, ...horizontal];
    const position = positions.find(([x, y]) => fits(x, maxLeft) && fits(y, maxTop));
    if (!position) {
      this.tooltipEl.style.display = "none";
      return;
    }
    this.tooltipEl.style.left = `${position[0]}px`;
    this.tooltipEl.style.top = `${position[1]}px`;
  }
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parts: string[] = [`<${tag}>`];

  // data-annotate or data-testid
  const dataAnnotate = el.getAttribute("data-annotate");
  const dataTestId =
    el.getAttribute("data-testid") ||
    el.getAttribute("data-test") ||
    el.getAttribute("data-cy");
  if (dataAnnotate) {
    parts.push(`[${dataAnnotate}]`);
  } else if (dataTestId) {
    parts.push(`[${dataTestId}]`);
  }

  // id
  if (el.id) {
    parts.push(`#${el.id}`);
  }

  // Meaningful classes (skip hashed ones, max 2)
  const classes = Array.from(el.classList)
    .filter(
      (c) =>
        !c.match(/^(sc-|css-)/) &&
        !c.match(/^[a-zA-Z0-9]{8,}$/) &&
        !c.match(/__[a-zA-Z0-9]{3,}$/),
    )
    .slice(0, 2);
  if (classes.length) {
    parts.push(`.${classes.join(".")}`);
  }

  // Direct text content only (not nested)
  const directText = getDirectText(el);
  if (directText) {
    parts.push(`"${directText}"`);
  }

  return parts.join(" ");
}

function getDirectText(el: Element): string {
  let text = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    }
  }
  text = text.trim();

  // Fallback: if no direct text and few children, use shallow textContent
  if (!text && el.children.length <= 2) {
    text = el.textContent?.trim() ?? "";
  }

  return text.slice(0, 30);
}
