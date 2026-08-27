// Font-size switch: html { font-size: 100% | 112.5% | 125% } persisted locally.
// Lives here, not in an app, because both SPAs must write the SAME localStorage key —
// otherwise "ใหญ่มาก" set in one app reads back as 100% in the other.
const KEY = 'rf-font-scale';

export const FONT_SCALES = [
  { value: '100%', label: 'ปกติ' },
  { value: '112.5%', label: 'ใหญ่' },
  { value: '125%', label: 'ใหญ่มาก' },
] as const;

export type FontScale = (typeof FONT_SCALES)[number]['value'];

export const currentFontScale = (): FontScale => {
  const stored = localStorage.getItem(KEY);
  return FONT_SCALES.some((entry) => entry.value === stored) ? (stored as FontScale) : '100%';
};

export const applyFontScale = (scale: FontScale): void => {
  document.documentElement.style.fontSize = scale;
  localStorage.setItem(KEY, scale);
};

/** Boot-time apply (main.tsx) so the choice survives reloads. */
export const initFontScale = (): void => {
  document.documentElement.style.fontSize = currentFontScale();
};
