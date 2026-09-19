import path from 'node:path'

/**
 * Loads brancher/.env into process.env. Imported first by the entry point, because other
 * modules read settings (like BRANCHER_SCAN_DIR) while they load.
 */
for (const candidate of [
  process.env.BRANCHER_ENV_FILE,
  path.resolve(import.meta.dirname, '../../.env'),
]) {
  if (!candidate) continue
  try {
    process.loadEnvFile(candidate)
    break
  } catch {
    // No .env there — everything in it is optional.
  }
}
