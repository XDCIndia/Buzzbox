import type { MentionEmotion, MentionSentiment } from '@/types';

// Best-effort keyword heuristic — NOT AI/ML. Used only as a starting guess
// for freshly-synced mentions; always user-editable afterward.

const POSITIVE_WORDS = ['love', 'great', 'amazing', 'awesome', 'excellent', 'best', 'thanks', 'thank you', 'nice', 'perfect', 'happy', 'impressive', 'fantastic', 'good'];
const NEGATIVE_WORDS = ['hate', 'worst', 'terrible', 'awful', 'bad', 'broken', 'issue', 'problem', 'bug', 'disappointed', 'angry', 'annoyed', 'scam', 'cancel', 'downgrade'];

const EMOTION_WORDS: Record<MentionEmotion, string[]> = {
  joy: ['love', 'great', 'amazing', 'awesome', 'happy', 'excited'],
  sadness: ['sad', 'disappointed', 'miss', 'unfortunate'],
  anger: ['hate', 'angry', 'furious', 'annoyed', 'terrible'],
  fear: ['worried', 'concerned', 'scared', 'risk'],
  surprise: ['wow', 'shocked', 'surprising', 'unexpected'],
  neutral: [],
};

function countMatches(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
}

export function classifySentiment(text: string): MentionSentiment {
  const pos = countMatches(text, POSITIVE_WORDS);
  const neg = countMatches(text, NEGATIVE_WORDS);
  if (pos === 0 && neg === 0) return 'neutral';
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}

export function classifyEmotion(text: string): MentionEmotion {
  let best: MentionEmotion = 'neutral';
  let bestCount = 0;
  for (const emotion of Object.keys(EMOTION_WORDS) as MentionEmotion[]) {
    const count = countMatches(text, EMOTION_WORDS[emotion]);
    if (count > bestCount) {
      best = emotion;
      bestCount = count;
    }
  }
  return best;
}

export function classifyMention(text: string): { sentiment: MentionSentiment; emotion: MentionEmotion } {
  return { sentiment: classifySentiment(text), emotion: classifyEmotion(text) };
}
