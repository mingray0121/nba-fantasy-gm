/** Reads a required env var at call time (never at import time, so builds don't need secrets). */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";
