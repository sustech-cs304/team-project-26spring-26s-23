import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const hoisted = vi.hoisted(() => {
  const mockDatabaseInstance = {
    pragma: vi.fn(),
    exec: vi.fn(),
    close: vi.fn(),
    prepare: vi.fn(),
  }

  const MockDatabase = vi.fn(function(this: typeof mockDatabaseInstance) { return mockDatabaseInstance }) as unknown as (new (path: string) => typeof mockDatabaseInstance)

  const mockApp = {
    getPath: vi.fn(() => '/test/user/data'),
  }

  return {
    mockDatabaseInstance,
    MockDatabase,
    mockApp,
  }
})

vi.mock('electron', () => ({
  app: hoisted.mockApp,
}))

vi.mock('better-sqlite3', () => ({
  default: hoisted.MockDatabase,
}))

import { getTimelineDatabase, closeTimelineDatabase } from './database'

describe('getTimelineDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeTimelineDatabase()

    hoisted.mockDatabaseInstance.pragma = vi.fn()
    hoisted.mockDatabaseInstance.exec = vi.fn()
    hoisted.mockDatabaseInstance.close = vi.fn()
    hoisted.mockDatabaseInstance.prepare = vi.fn()
  })

  it('creates a database file at the userData path', () => {
    getTimelineDatabase()

    expect(hoisted.mockApp.getPath).toHaveBeenCalledWith('userData')
    expect(hoisted.MockDatabase).toHaveBeenCalledWith(path.join('/test/user/data', 'timeline.db'))
  })

  it('enables WAL journal mode on initialization', () => {
    getTimelineDatabase()

    expect(hoisted.mockDatabaseInstance.pragma).toHaveBeenCalledWith('journal_mode = WAL')
  })

  it('creates the timeline_events table with correct schema on initialization', () => {
    getTimelineDatabase()

    expect(hoisted.mockDatabaseInstance.exec).toHaveBeenCalledTimes(1)
    const execCall = hoisted.mockDatabaseInstance.exec.mock.calls[0]?.[0] as string | undefined

    expect(execCall).toBeDefined()
    expect(execCall).toContain('CREATE TABLE IF NOT EXISTS timeline_events')
    expect(execCall).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(execCall).toContain('source TEXT NOT NULL')
    expect(execCall).toContain('source_id TEXT')
    expect(execCall).toContain('title TEXT NOT NULL')
    expect(execCall).toContain('description TEXT')
    expect(execCall).toContain('start_time TEXT NOT NULL')
    expect(execCall).toContain('end_time TEXT')
    expect(execCall).toContain('is_all_day INTEGER NOT NULL DEFAULT 0')
    expect(execCall).toContain('location TEXT')
    expect(execCall).toContain("status TEXT NOT NULL DEFAULT 'not_started'")
    expect(execCall).toContain('metadata_payload TEXT')
    expect(execCall).toContain('progress REAL DEFAULT 0')
    expect(execCall).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP')
    expect(execCall).toContain('updated_at DATETIME DEFAULT CURRENT_TIMESTAMP')
  })

  it('returns the same database instance on subsequent calls (singleton)', () => {
    const db1 = getTimelineDatabase()
    const db2 = getTimelineDatabase()

    expect(db1).toBe(db2)
    expect(hoisted.MockDatabase).toHaveBeenCalledTimes(1)
  })

  it('does not re-initialize schema when called again', () => {
    getTimelineDatabase()
    getTimelineDatabase()

    expect(hoisted.mockDatabaseInstance.exec).toHaveBeenCalledTimes(1)
    expect(hoisted.mockDatabaseInstance.pragma).toHaveBeenCalledTimes(1)
  })
})

describe('closeTimelineDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeTimelineDatabase()

    hoisted.mockDatabaseInstance.pragma = vi.fn()
    hoisted.mockDatabaseInstance.exec = vi.fn()
    hoisted.mockDatabaseInstance.close = vi.fn()
    hoisted.mockDatabaseInstance.prepare = vi.fn()
  })

  it('closes the database and clears the singleton', () => {
    getTimelineDatabase()
    closeTimelineDatabase()

    expect(hoisted.mockDatabaseInstance.close).toHaveBeenCalledTimes(1)

    // After close, a new call should create a fresh instance
    getTimelineDatabase()
    expect(hoisted.MockDatabase).toHaveBeenCalledTimes(2)
  })

  it('does nothing when called without an active database', () => {
    closeTimelineDatabase()

    expect(hoisted.mockDatabaseInstance.close).not.toHaveBeenCalled()
  })

  it('handles close errors gracefully', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hoisted.mockDatabaseInstance.close = vi.fn(() => {
      throw new Error('close failed')
    })

    getTimelineDatabase()
    expect(() => closeTimelineDatabase()).not.toThrow()

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[timeline-database] Error closing database:',
      expect.any(Error),
    )
    consoleWarnSpy.mockRestore()
  })

  it('clears the instance even when close throws', () => {
    hoisted.mockDatabaseInstance.close = vi.fn(() => {
      throw new Error('close failed')
    })

    getTimelineDatabase()
    closeTimelineDatabase()

    getTimelineDatabase()
    expect(hoisted.MockDatabase).toHaveBeenCalledTimes(2)
  })
})
