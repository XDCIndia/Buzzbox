import { NextResponse } from 'next/server';
import { isXOAuthConfigured } from '@/lib/x-oauth';

function isGoogleEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim() &&
    process.env.GOOGLE_REDIRECT_URI?.trim(),
  );
}

export async function GET() {
  return NextResponse.json({
    google: isGoogleEnabled(),
    x: isXOAuthConfigured(),
  });
}

