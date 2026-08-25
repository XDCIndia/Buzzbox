export function parseAppliedTo(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
      console.warn('[experiments] Invalid applied_to data');
      return [];
    }

    return parsed;
  } catch {
    console.warn('[experiments] Failed to parse applied_to data');
    return [];
  }
}
