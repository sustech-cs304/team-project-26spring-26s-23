import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'

let dbInstance: Database.Database | null = null

export interface TimelineEventRow {
  id: number
  source: string
  source_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  is_all_day: number
  location: string | null
  status: string
  metadata_payload: string | null
  progress: number | null
  created_at: string
  updated_at: string
}

export function getTimelineDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance
  }

  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'timeline.db')

  dbInstance = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  dbInstance.pragma('journal_mode = WAL')

  // Initialize schema
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS timeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      metadata_payload TEXT,
      progress REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS update_timeline_events_updated_at
    AFTER UPDATE ON timeline_events
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE timeline_events
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.id;
    END;
  `)

  return dbInstance
}

export function closeTimelineDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch (err) {
      console.warn('[timeline-database] Error closing database:', err)
    } finally {
      dbInstance = null
    }
  }
}
