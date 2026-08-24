const DICOMPUTE_BASE_URL =
  process.env.DICOMPUTE_BASE_URL || 'https://api.dicompute.ai/v1';

const DICOMPUTE_MODEL =
  process.env.DICOMPUTE_MODEL || 'qwen2.5-7b-instruct';

const DICOMPUTE_API_KEY = process.env.DICOMPUTE_API_KEY;

export interface DicomputeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function askDicompute(
  messages: DicomputeMessage[],
) {
  if (!DICOMPUTE_API_KEY) {
    throw new Error('DICOMPUTE_API_KEY is not configured');
  }

  const response = await fetch(
    `${DICOMPUTE_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DICOMPUTE_API_KEY}`,
      },
      body: JSON.stringify({
        model: DICOMPUTE_MODEL,
        messages,
        temperature: 0.3,
        stream: false,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `DICOMPUTE request failed (${response.status}): ${error}`,
    );
  }

  const data = await response.json();

  return {
    content: data?.choices?.[0]?.message?.content || '',
    model: data?.model || DICOMPUTE_MODEL,
    raw: data,
  };
}