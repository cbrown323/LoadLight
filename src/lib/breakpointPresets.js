/**
 * Shared breakpoint presets for responsive export / UI (no store coupling).
 */

export const BP_PRESETS = {
  none: [],
  standard: [
    { name: 'Desktop XL', w: 1920 },
    { name: 'Desktop', w: 1280 },
    { name: 'Tablet', w: 768 },
    { name: 'Mobile', w: 480 },
  ],
  mobile: [
    { name: 'Mobile', w: 360 },
    { name: 'Tablet', w: 768 },
    { name: 'Desktop', w: 1280 },
  ],
  custom: [
    { name: 'Custom 1', w: 1440 },
    { name: 'Custom 2', w: 720 },
  ],
}

/** Portrait presets — height is the constraining dimension */
export const BP_PRESETS_PORTRAIT = {
  none: [],
  standard: [
    { name: 'Full', w: 1920 },
    { name: 'Large', w: 1280 },
    { name: 'Medium', w: 900 },
    { name: 'Small', w: 600 },
  ],
  mobile: [
    { name: 'Small', w: 480 },
    { name: 'Medium', w: 900 },
    { name: 'Large', w: 1280 },
  ],
  custom: [
    { name: 'Custom 1', w: 1080 },
    { name: 'Custom 2', w: 720 },
  ],
}

export function isPortrait(fo) {
  return fo && fo.height > 0 && fo.width > 0 && fo.height > fo.width
}

/**
 * Breakpoint rows ({ name, w }) for one file, matching setActiveIdx / export logic.
 * @param {{ width?: number, height?: number }} fo
 * @param {'none'|'standard'|'mobile'|'custom'} responsiveMode
 * @param {Array<{ name?: string, w: number }>} customBreakpoints — store.breakpoints when mode is custom
 */
export function getBreakpointsForFile(fo, responsiveMode, customBreakpoints = []) {
  if (responsiveMode === 'none') return []
  if (responsiveMode === 'custom')
    return [...customBreakpoints].sort((a, b) => b.w - a.w)
  const presetSrc = isPortrait(fo) ? BP_PRESETS_PORTRAIT : BP_PRESETS
  return (presetSrc[responsiveMode] || []).slice()
}
