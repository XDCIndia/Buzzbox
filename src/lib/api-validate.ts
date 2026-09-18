/* Request-body validation for API routes.
 *
 * Wraps zod v4 so call sites stay one-liners: validate the parsed JSON body,
 * get back either typed data or a ready-to-return NextResponse 400 with
 * flattened field errors. Intentionally minimal — no middleware magic.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

export type ValidatedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export function validateBody<S extends z.ZodType>(
  body: unknown,
  schema: S,
): ValidatedBody<z.output<S>> {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'Validation failed',
        issues: z.flattenError(result.error),
      },
      { status: 400 },
    ),
  };
}

/** Convenience: parse the request JSON then validate in one step. */
export async function parseAndValidate<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ValidatedBody<z.output<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
    };
  }
  return validateBody(body, schema);
}
