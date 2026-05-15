import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'

let dbInstance: Database.Database | null = null

export function getTimelineDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance
  }

  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'timeline.db')

  dbInstance = new Database(dbPath)

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
    BEGIN
      UPDATE timeline_events
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.id;
    END;
  `)

  return dbInstance
}