/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import type { DesktopRuntimeApi } from '../../../electron/desktop-runtime'
import { resolveWakeupIcsImportResult } from './settings-workspace-sideflows'
import { isWakeupIcsText, normalizeWakeupIcsText } from './wakeup-ics-text'

describe('WakeUP ICS import helpers', () => {
  it('strips a UTF-8 BOM before detecting and importing calendar text', async () => {
    const normalizedIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Candue//WakeUp BOM//EN',
      'END:VCALENDAR',
    ].join('\n')
    const importWakeupIcs = vi.fn<DesktopRuntimeApi['importWakeupIcs']>().mockResolvedValue({ ok: true, parsed: 2 })

    Object.assign(window, {
      desktopRuntime: {
        loadCalendarEvents: vi.fn<DesktopRuntimeApi['loadCalendarEvents']>(),
        importWakeupIcs,
      } satisfies DesktopRuntimeApi,
    })

    await expect(resolveWakeupIcsImportResult(`\uFEFF${normalizedIcs}`, 'en-US')).resolves.toEqual({
      ok: true,
      parsed: 2,
    })
    expect(importWakeupIcs).toHaveBeenCalledWith({ icsText: normalizedIcs })
    expect(isWakeupIcsText(`\uFEFF${normalizedIcs}`)).toBe(true)
    expect(normalizeWakeupIcsText(`\uFEFF${normalizedIcs}`)).toBe(normalizedIcs)
  })

  it('returns localized English validation failures', async () => {
    await expect(resolveWakeupIcsImportResult('', 'en-US')).resolves.toEqual({
      ok: false,
      error: 'No .ics file selected',
    })
    await expect(resolveWakeupIcsImportResult('plain text', 'en-US')).resolves.toEqual({
      ok: false,
      error: 'The selected file is not valid .ics content',
    })
  })
})
