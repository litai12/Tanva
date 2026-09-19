export type SelectionRect = { x: number; y: number; width: number; height: number };

/** Largest clear rectangle after subtracting floating chat panels. All values are local CSS pixels. */
export function computeSelectionSafeArea(area: SelectionRect, obstacles: SelectionRect[]): SelectionRect | null {
  let candidates = [area];
  for (const o of obstacles) {
    candidates = candidates.flatMap(r => {
      const left = Math.max(r.x, o.x - 12);
      const right = Math.min(r.x + r.width, o.x + o.width + 12);
      const top = Math.max(r.y, o.y - 12);
      const bottom = Math.min(r.y + r.height, o.y + o.height + 12);
      if (left >= right || top >= bottom) return [r];
      return [
        { ...r, width: left - r.x },
        { ...r, x: right, width: r.x + r.width - right },
        { ...r, height: top - r.y },
        { ...r, y: bottom, height: r.y + r.height - bottom },
      ].filter(c => c.width >= 160 && c.height >= 80);
    });
  }
  return candidates.sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
}

export function fitSelectionInArea(bounds: SelectionRect, area: SelectionRect, currentZoom: number) {
  // Reserve the bottom strip for the selection toolbar, and padding around nodes.
  const width = Math.max(1, area.width - 48);
  const height = Math.max(1, area.height - 104);
  const zoom = Math.max(0.1, Math.min(currentZoom, width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)));
  return {
    x: area.x + area.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: area.y + 24 + height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}
