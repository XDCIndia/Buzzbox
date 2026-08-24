import { NextResponse } from 'next/server';
import { askDicompute } from '@/lib/dicompute';

export async function GET() {
  try {
    const result = await askDicompute([
      {
        role: 'system',
        content:
          'You are Buzz, the AI assistant for Buzzbox.',
      },
      {
        role: 'user',
        content:
          'Say hello and confirm that you are running successfully.',
      },
    ]);

    return NextResponse.json({
      success: true,
      response: result.content,
      model: result.model,
    });
  } catch (error) {
    console.error('DICOMPUTE test failed:', error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error',
      },
      { status: 500 },
    );
  }
}