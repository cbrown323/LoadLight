/**
 * presets.js
 * Save / load named presets to localStorage.
 * Each preset stores: format, quality, responsiveMode, breakpoints,
 * advResolution, advBitrate, advFps, generateSnippet, generatePoster, exportAs.
 */

const KEY = 'loadlight_presets'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') }
  catch { return {} }
}

function save(presets) {
  localStorage.setItem(KEY, JSON.stringify(presets))
}

export function savePreset(name, settings) {
  if (!name?.trim()) return false
  const presets = load()
  presets[name.trim()] = { ...settings, savedAt: Date.now() }
  save(presets)
  return true
}

export function loadPreset(name) {
  return load()[name] || null
}

export function listPresets() {
  const all = load()
  return Object.entries(all)
    .map(([name, data]) => ({ name, savedAt: data.savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function deletePreset(name) {
  const presets = load()
  delete presets[name]
  save(presets)
}
