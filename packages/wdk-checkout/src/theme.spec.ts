/**
 * Theme resolution — presets, light/dark mode + auto-detect, and override
 * layering (Phase 5 item 14). The per-element radii + button-style tokens
 * (item 13) are exercised through the widget; here we lock the pure resolver.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveCheckoutTheme,
  CHECKOUT_THEMES,
  DEFAULT_CHECKOUT_THEME,
  DARK_CHECKOUT_THEME,
  INSTITUTIONAL_LIGHT_CHECKOUT_THEME,
} from './types.js'

describe('CHECKOUT_THEMES presets', () => {
  it('exposes the four named presets with distinct accents', () => {
    expect(Object.keys(CHECKOUT_THEMES).sort()).toEqual(['cool-dark', 'dark', 'institutional-light', 'wdk'])
    expect(CHECKOUT_THEMES['institutional-light'].accent).toBe('#1d4ed8')
    expect(CHECKOUT_THEMES['cool-dark'].accent).toBe('#2f81f7')
  })
})

describe('resolveCheckoutTheme', () => {
  it('defaults to the WDK light theme', () => {
    expect(resolveCheckoutTheme()).toEqual(DEFAULT_CHECKOUT_THEME)
  })

  it('selects a base by preset name', () => {
    expect(resolveCheckoutTheme({ preset: 'institutional-light' })).toEqual(INSTITUTIONAL_LIGHT_CHECKOUT_THEME)
    expect(resolveCheckoutTheme({ preset: 'dark' })).toEqual(DARK_CHECKOUT_THEME)
  })

  it('honors an explicit mode', () => {
    expect(resolveCheckoutTheme({ mode: 'dark' })).toEqual(DARK_CHECKOUT_THEME)
    expect(resolveCheckoutTheme({ mode: 'light' })).toEqual(DEFAULT_CHECKOUT_THEME)
  })

  it('auto mode follows prefers-color-scheme', () => {
    expect(resolveCheckoutTheme({ mode: 'auto' }, true)).toEqual(DARK_CHECKOUT_THEME)
    expect(resolveCheckoutTheme({ mode: 'auto' }, false)).toEqual(DEFAULT_CHECKOUT_THEME)
    // preset:'auto' is shorthand for mode:'auto'
    expect(resolveCheckoutTheme({ preset: 'auto' }, true)).toEqual(DARK_CHECKOUT_THEME)
  })

  it('an explicit preset wins over mode', () => {
    expect(resolveCheckoutTheme({ preset: 'cool-dark', mode: 'light' })).toEqual(CHECKOUT_THEMES['cool-dark'])
  })

  it('layers the theme partial over the resolved base', () => {
    const t = resolveCheckoutTheme({ preset: 'dark', theme: { accent: '#00ff88', buttonStyle: 'soft', buttonRadius: '999px' } })
    expect(t.accent).toBe('#00ff88')
    expect(t.buttonStyle).toBe('soft')
    expect(t.buttonRadius).toBe('999px')
    // untouched tokens come from the base preset
    expect(t.surface).toBe(DARK_CHECKOUT_THEME.surface)
  })
})
