import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

/**
 * Loads environment variables from .env file only if they're not already set.
 * This allows the existing process.env mechanism to work in different environments
 * (like production) while providing a fallback for local development.
 */
export function loadEnvIfNeeded(): void {
  // Check if required env vars are already set
  const hasClientId = !!process.env.X_CLIENT_ID;
  const hasClientSecret = !!process.env.X_CLIENT_SECRET;
  
  // If both are already set, no need to load .env
  if (hasClientId && hasClientSecret) {
    return;
  }
  
  // Try to find .env file in current directory or parent directories
  const possiblePaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
  ];
  
  const envPath = possiblePaths.find(path => existsSync(path));
  
  if (envPath) {
    // Load .env file, but don't override existing env vars
    config({ path: envPath, override: false });
  }
}

