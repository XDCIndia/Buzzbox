import { NextRequest, NextResponse } from 'next/server';
import { askDicompute } from '@/lib/dicompute';
import { sendOrchestratorMessage } from '@/lib/command';
import { requireApiAdmin } from '@/lib/api-auth';
import { getOverviewStats, getAlerts, getPendingApprovals, getLeadFunnel, getDailyMetrics, createBuzzContentDraft } from '@/lib/queries';
import { computeSocialAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

const BUZZ_SYSTEM_PROMPT = `
You are Buzz, the AI assistant inside Buzzbox.

Buzzbox is a marketing operations command center.

You have two responsibilities:

1. Answer normal questions about Buzzbox.
2. Identify when the user wants an actual task performed by the Buzzbox agent system.

When the user wants to see Buzzbox overview information, return:

{
  "action": "overview",
  "message": "Get today's Buzzbox overview"
}

When the user wants to see pending approvals, return:

{
  "action": "approvals",
  "message": "Get all pending content and email approvals"
}

When the user wants to see the current sales pipeline or lead funnel, return:

{
  "action": "pipeline",
  "message": "Get the current Buzzbox lead pipeline"
}

When the user asks about social media performance, engagement,
impressions, engagement rate, X/Twitter performance, LinkedIn
performance, or social analytics, return:

{
  "action": "analytics",
  "message": "Analyze the current Buzzbox social media performance"
}

When the user wants an action performed by an agent, return:

{
  "action": "execute",
  "message": "the exact task that should be sent to the Buzzbox orchestrator"
}

When the user is only asking a question or wants an explanation, return ONLY valid JSON:

{
  "action": "respond",
  "message": "your answer"
}

When the user asks Buzz to create, draft, write, or prepare social media content,
return:

{
  "action": "create_content",
  "message": "Create the requested content as a draft. Do not publish it."
}


Examples:

User:
"Hello Buzz"

Response:
{
  "action": "respond",
  "message": "Hi! I'm Buzz. How can I help?"
}

User:
"Show me today's marketing overview"

Response:
{
  "action": "execute",
  "message": "Give me today's marketing overview and summarize the important metrics for the user."
}

User:
"Show me the current pipeline"

Response:
{
  "action": "pipeline",
  "message": "Get the current Buzzbox lead pipeline"
}

User:
"How many interested leads do we have?"

Response:
{
  "action": "pipeline",
  "message": "Get the current Buzzbox lead pipeline"
}

User:
"Create 5 LinkedIn posts about our new product"

Response:
{
  "action": "create_content",
  "message": "Create 5 LinkedIn posts about the new product as drafts. Do not publish them."
}

User:
"What is a marketing funnel?"

Response:
{
  "action": "respond",
  "message": "A marketing funnel describes the journey from awareness to conversion..."
}

User:
"Buzz, give me today's overview"

Response:
{
  "action": "overview",
  "message": "Get today's Buzzbox overview"
}

User:
"Show me pending approvals"

Response:
{
  "action": "approvals",
  "message": "Get all pending content and email approvals"
}


User:
"Analyze our social media performance"

Response:
{
  "action": "analytics",
  "message": "Analyze the current Buzzbox social media performance"
}

User:
"How is our engagement doing?"

Response:
{
  "action": "analytics",
  "message": "Analyze the current Buzzbox social media performance"
}

User:
"Create a LinkedIn post about our new campaign"

Response:
{
  "action": "create_content",
  "message": "Create a LinkedIn post about our new campaign as a draft. Do not publish it."
}

User:
"Write 5 Instagram posts about our product"

Response:
{
  "action": "create_content",
  "message": "Create 5 Instagram posts about our product as drafts. Do not publish them."
}

IMPORTANT:
- Always return valid JSON.
- Never use markdown around the JSON.
- Never expose API keys, tokens, passwords, or secrets.
- Do not claim an action was completed unless the orchestrator actually completed it.
- Keep responses concise and useful.
- Content creation through Buzz must create drafts only.
- Never publish automatically.
`;

type BuzzDecision = {
  action: 'respond' | 'execute' | 'overview' | 'analytics' | 'approvals' | 'create_content' | 'pipeline';
  message: string;
};

function parseBuzzDecision(content: string): BuzzDecision {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    if (
      parsed &&
      (parsed.action === 'respond' ||
        parsed.action === 'overview' ||
        parsed.action === 'approvals' ||
        parsed.action === 'pipeline' ||
        parsed.action === 'analytics' ||
        parsed.action === 'create_content' ||
        parsed.action === 'execute') &&
      typeof parsed.message === 'string'
    ) {
      return {
        action: parsed.action,
        message: parsed.message,
      };
    }
  } catch {
    // Continue to JSON extraction.
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(
        cleaned.slice(start, end + 1),
      );

      if (
        parsed &&
        (parsed.action === 'respond' ||
          parsed.action === 'overview' ||
          parsed.action === 'approvals' ||
          parsed.action === 'pipeline' ||
          parsed.action === 'analytics' ||
          parsed.action === 'create_content' ||
          parsed.action === 'execute') &&
        typeof parsed.message === 'string'
      ) {
        return {
          action: parsed.action,
          message: parsed.message,
        };
      }
    } catch {
      // Fall through.
    }
  }

  return {
    action: 'respond',
    message: cleaned,
  };
}

export async function POST(request: NextRequest) {
  const auth = requireApiAdmin(request as Request);

  if (auth) return auth;

  try {
    const body = await request.json();

    const userMessage = String(body.message || '').trim();

    if (!userMessage) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      );
    }

    /*
     * STEP 1
     * Ask Qwen what the user wants.
     */
    const decisionResult = await askDicompute([
      {
        role: 'system',
        content: BUZZ_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ]);

    const decision = parseBuzzDecision(
      decisionResult.content,
    );

    /*
     * STEP 2
     * Normal conversation.
     */
    if (decision.action === 'respond') {
      return NextResponse.json({
        ok: true,
        type: 'response',
        message: decision.message,
      });
    }
        /*
    * Read-only pending approvals.
    */
    if (decision.action === 'approvals') {
      const approvals = getPendingApprovals();

      const approvalResult = await askDicompute([
        {
          role: 'system',
          content: `
          You are Buzz, the AI assistant inside Buzzbox.

          You have received real pending approval data from Buzzbox.

          Summarize it clearly for the user.

          Include:
          - Total number of pending approvals
          - Pending social/content items
          - Pending email sequences
          - Platform names when available
          - Useful titles, subjects, or previews when available

          If there are no pending approvals, clearly say:
          "There are currently no pending approvals."

          Do not invent information.
          Only use the supplied data.
          `,
        },
        {
          role: 'user',
          content: `
          Pending Buzzbox approvals:

    ${JSON.stringify(approvals, null, 2)}
    `,
        },
      ]);

      return NextResponse.json({
        ok: true,
        type: 'approvals',
        message: approvalResult.content,
      });
    }
       /*
      * Read-only Buzzbox pipeline.
      */
      if (decision.action === 'pipeline') {
        const funnel = getLeadFunnel({
          excludeSeed: false,
        });

        const pipelineResult = await askDicompute([
          {
            role: 'system',
            content: `
      You are Buzz, the AI assistant inside Buzzbox.

      You have received real lead pipeline data from Buzzbox.

      Summarize the pipeline clearly for the user.

      Include:
      - Total number of leads
      - Number of leads in each stage
      - Interested leads
      - Booked leads
      - Qualified leads
      - Rejected/disqualified leads
      - Any useful observation about the pipeline

      Do not invent information.
      Only use the supplied data.

      If all stages are zero, clearly say that the pipeline currently has no leads.
      `,
          },
          {
            role: 'user',
            content: `
      Current Buzzbox lead pipeline:

      ${JSON.stringify(funnel, null, 2)}
      `,
          },
        ]);

        return NextResponse.json({
          ok: true,
          type: 'pipeline',
          message: pipelineResult.content,
        });
      }
        /*
    * Read-only social analytics.
    */
    if (decision.action === 'analytics') {
      const dailyMetrics = getDailyMetrics(30, {
        excludeSeed: false,
      });

      const analytics = computeSocialAnalytics(
        [...dailyMetrics].reverse(),
      );

      const analyticsResult = await askDicompute([
        {
          role: 'system',
          content: `
    You are Buzz, the AI assistant inside Buzzbox.

    You have received real social media analytics from Buzzbox.

    Analyze the performance clearly and concisely.

    Include:
    - Total impressions
    - Total engagement
    - Engagement rate
    - X/Twitter posts, replies, quote tweets and follows
    - LinkedIn comments
    - Leads generated
    - Emails sent

    Give a short useful interpretation of the numbers.

    Do not invent information.
    Only use the supplied data.

    If the numbers are zero, clearly say that there is currently
    no recorded activity in the selected period.
    `,
        },
        {
          role: 'user',
          content: `
    Buzzbox social analytics for the last 30 days:

    ${JSON.stringify(analytics, null, 2)}
    `,
        },
      ]);

      return NextResponse.json({
        ok: true,
        type: 'analytics',
        message: analyticsResult.content,
      });
    }

        /*
    * Read-only Buzzbox overview.
    */
    if (decision.action === 'overview') {
      const stats = getOverviewStats({
        excludeSeed: false,
      });

      const alerts = getAlerts({
        excludeSeed: false,
      });

      const overviewResult = await askDicompute([
        {
          role: 'system',
          content: `
    You are Buzz, the AI assistant inside Buzzbox.

    You have received real Buzzbox overview data.

    Explain it to the user clearly and concisely.

    Include:
    - Posts today
    - Engagements today
    - Emails sent today
    - Current pipeline
    - Important alerts, if any

    Do not invent information.
    Only use the supplied data.
    If there are no alerts, say there are no active alerts.
    `,
        },
        {
          role: 'user',
          content: `
    Today's Buzzbox overview:

    Statistics:
    ${JSON.stringify(stats, null, 2)}

    Alerts:
    ${JSON.stringify(alerts, null, 2)}
    `,
        },
      ]);

      return NextResponse.json({
        ok: true,
        type: 'overview',
        message: overviewResult.content,
      });
    }
    
    if (decision.action === 'create_content') {
      /*
      * Ask Qwen to generate the actual content.
      * We keep this separate from the first decision call
      * so the database only receives actual post content.
      */
      const contentResult = await askDicompute([
        {
          role: 'system',
          content: `
    You are Buzz's content generation engine.

    Generate the social media content requested by the user.

    Return ONLY valid JSON with this exact structure:

    {
      "platform": "linkedin",
      "content": "The complete social media post"
    }

    Rules:
    - platform must be one of: linkedin, twitter, instagram
    - content must contain the complete post
    - Do not use markdown code fences.
    - Do not include explanations outside the JSON.
    - Do not claim the post was published.
    - This content will be saved as a DRAFT only.
    `,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ]);

      let generatedContent: {
        platform: string;
        content: string;
      };

      try {
        const cleaned = contentResult.content
          .trim()
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        generatedContent = JSON.parse(cleaned);
      } catch {
        return NextResponse.json(
          {
            error: 'Buzz generated invalid content data',
            details: contentResult.content,
          },
          { status: 500 },
        );
      }

      if (
        !generatedContent.platform ||
        !generatedContent.content
      ) {
        return NextResponse.json(
          {
            error: 'Buzz generated incomplete content data',
          },
          { status: 500 },
        );
      }

      const platform =
        generatedContent.platform.toLowerCase();

      const allowedPlatforms = [
        'linkedin',
        'twitter',
        'instagram',
      ];

      if (!allowedPlatforms.includes(platform)) {
        return NextResponse.json(
          {
            error: `Unsupported platform: ${generatedContent.platform}`,
          },
          { status: 400 },
        );
      }

      /*
      * Actually create the draft in Buzzbox.
      */
      const draft = createBuzzContentDraft({
        platform,
        content: generatedContent.content,
      });

      if (!draft) {
        return NextResponse.json(
          {
            error: 'Buzz could not create the content draft',
          },
          { status: 500 },
        );
      }

      /*
      * Only report success after the database
      * confirms that the draft exists.
      */
      return NextResponse.json({
        ok: true,
        type: 'create_content',
        message: `Created a ${platform} draft successfully. It has been saved to the Content queue and has not been published.`,
        draft,
      });
    }

    /*
     * STEP 4
     * User requested an actual Buzzbox task.
     *
     * Send it to the existing orchestrator.
     */
    const orchestratorResult =
      await sendOrchestratorMessage(
        decision.message,
      );

    /*
     * STEP 5
     * Ask Qwen to turn the raw agent result
     * into a clean Buzz response.
     */
    const finalResult = await askDicompute([
      {
        role: 'system',
        content: `
        You are Buzz, the AI assistant inside Buzzbox.

        The Buzzbox orchestrator has just executed a task.

        Explain the result to the user clearly and concisely.

        IMPORTANT:
        - Do not invent information.
        - Only use information contained in the orchestrator result.
        - If the operation failed, clearly explain that it failed.
        - Do not expose internal credentials or secrets.
        `,
      },
      {
        role: 'user',
        content: `
        Original user request:
        ${userMessage}
        Orchestrator result:
        ${orchestratorResult.response}
        `,
      },
    ]);

    return NextResponse.json({
      ok: true,
      type: 'execution',
      message: finalResult.content,
      orchestratorResponse: orchestratorResult.response,
    });
  } catch (error) {
    console.error('Buzz API error:', error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Buzz encountered an unexpected error',
      },
      { status: 500 },
    );
  }
}