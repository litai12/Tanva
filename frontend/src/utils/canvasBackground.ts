export type CanvasColorScheme = 'light' | 'dark';
export type CanvasBackgroundPreferences = Record<CanvasColorScheme, string | null>;

// Tanva's existing defaults; null preserves theme CSS and legacy grid settings.
export const CANVAS_DEFAULT_BACKGROUND: Record<CanvasColorScheme, string> = {
  light: '#ffffff',
  dark: '#090909',
};

export const CANVAS_BACKGROUND_SWATCHES: Record<CanvasColorScheme, string[]> = {
  light: ['#f3f4f6', '#ffffff', '#ede7e1', '#d3c3c3', '#e3eaf2', '#e4efe4', '#ebe7f5'],
  dark: ['#0c0c0d', '#000000', '#17181c', '#1f1b18', '#151c26', '#14201a', '#1d1a26'],
};

export function normalizeHexColor(input: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const raw = match[1].length === 3
    ? match[1].split('').map((value) => value + value).join('')
    : match[1];
  return `#${raw.toLowerCase()}`;
}

export function sanitizeBackgroundPreferences(value: unknown): CanvasBackgroundPreferences {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const color = (scheme: CanvasColorScheme) => typeof record[scheme] === 'string'
    ? normalizeHexColor(record[scheme]) : null;
  return { light: color('light'), dark: color('dark') };
}

export function hexLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return 0;
  const number = Number.parseInt(normalized.slice(1), 16);
  const channel = (value: number) => {
    const color = value / 255;
    return color <= 0.03928 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((number >> 16) & 255)
    + 0.7152 * channel((number >> 8) & 255) + 0.0722 * channel(number & 255);
}

export const canvasGridInk = (background: string): string =>
  hexLuminance(background) > 0.4 ? '#000000' : '#ffffff';

export interface HsvColor { h: number; s: number; v: number }

export function hexToHsv(hex: string): HsvColor {
  const number = Number.parseInt((normalizeHexColor(hex) ?? '#000000').slice(1), 16);
  const red = ((number >> 16) & 255) / 255;
  const green = ((number >> 8) & 255) / 255;
  const blue = (number & 255) / 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let hue = 0;
  if (delta) {
    hue = max === red ? (green - blue) / delta
      : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    hue = ((hue * 60) + 360) % 360;
  }
  return { h: hue, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const saturation = Math.min(1, Math.max(0, s));
  const value = Math.min(1, Math.max(0, v));
  const sector = (((h % 360) + 360) % 360) / 60;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(sector % 2 - 1));
  const channels = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0]
    : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma]
      : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${channels.map((channel) => Math.round((channel + value - chroma) * 255)
    .toString(16).padStart(2, '0')).join('')}`;
}
