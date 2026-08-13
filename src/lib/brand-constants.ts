// Fixed UUID for the single seeded brand row — keeps /brand/{id}/... URLs stable
// across restarts instead of a lookup-by-slug indirection.
export const DEFAULT_BRAND_ID = '97cdb115-2c90-42a8-b904-d14abce1d682';

export const MENTION_PLATFORMS = ['x', 'facebook', 'instagram', 'linkedin', 'reddit', 'tiktok', 'threads', 'youtube'];
export const MENTION_SENTIMENTS = ['positive', 'negative', 'neutral'];
