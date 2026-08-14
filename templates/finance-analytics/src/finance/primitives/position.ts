export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PositionOptions {
  side?: Side;
  align?: Align;
  gap?: number;
  padding?: number;
}

export interface PositionResult {
  left: number;
  top: number;
  side: Side;
}

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function coords(
  side: Side,
  align: Align,
  anchor: AnchorRect,
  floating: { width: number; height: number },
  gap: number,
): { left: number; top: number } {
  const isVertical = side === "top" || side === "bottom";
  let left = 0;
  let top = 0;

  if (isVertical) {
    top = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - floating.height - gap;
    if (align === "start") left = anchor.left;
    else if (align === "end") left = anchor.left + anchor.width - floating.width;
    else left = anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = side === "right" ? anchor.left + anchor.width + gap : anchor.left - floating.width - gap;
    if (align === "start") top = anchor.top;
    else if (align === "end") top = anchor.top + anchor.height - floating.height;
    else top = anchor.top + anchor.height / 2 - floating.height / 2;
  }

  return { left, top };
}

function fits(
  pos: { left: number; top: number },
  floating: { width: number; height: number },
  padding: number,
  viewport: { width: number; height: number },
): boolean {
  return (
    pos.left >= padding &&
    pos.top >= padding &&
    pos.left + floating.width <= viewport.width - padding &&
    pos.top + floating.height <= viewport.height - padding
  );
}

/**
 * Zero-dependency floating positioner. Computes viewport-relative coordinates for a
 * floating element anchored to a reference rect, flipping to the opposite side on
 * overflow and clamping into the viewport as a last resort.
 */
export function computePosition(
  anchor: AnchorRect,
  floating: { width: number; height: number },
  opts: PositionOptions = {},
): PositionResult {
  const side = opts.side ?? "bottom";
  const align = opts.align ?? "start";
  const gap = opts.gap ?? 6;
  const padding = opts.padding ?? 8;

  const viewport = {
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
  };

  const primary = coords(side, align, anchor, floating, gap);
  let chosenSide = side;
  let pos = primary;

  if (!fits(primary, floating, padding, viewport)) {
    const flipped = coords(OPPOSITE[side], align, anchor, floating, gap);
    if (fits(flipped, floating, padding, viewport)) {
      chosenSide = OPPOSITE[side];
      pos = flipped;
    }
  }

  const left = Math.min(
    Math.max(pos.left, padding),
    Math.max(padding, viewport.width - floating.width - padding),
  );
  const top = Math.min(
    Math.max(pos.top, padding),
    Math.max(padding, viewport.height - floating.height - padding),
  );

  return { left, top, side: chosenSide };
}
