import path from 'node:path'

/**
 * Loads brancher/.env into process.env. Imported first by the entry point, because other
 * modules read settings (like BRANCHER_SCAN_DIR) while they load.
 */
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'))
} catch {
  // No .env — everything in it is optional.
}
