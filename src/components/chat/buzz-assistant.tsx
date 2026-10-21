'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles, Loader2, RotateCcw } from 'lucide-react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  /** Marks a failed request bubble instead of a real answer (#225). */
  error?: boolean;
  /** The original user text, so Retry re-sends it without duplicating the thread. */
  retryOf?: string;
  /** False for non-transient failures (missing config / bad request): no retry UI. */
  retryable?: boolean;
};

/** Client-side ceiling. The server bounds its own upstream calls; this only
 * catches a stalled connection so the thread can never sit on "Buzz is
 * thinking..." forever (#225). */
const CLIENT_TIMEOUT_MS = 120_000;

type ConnectorStatus = 'unknown' | 'ready' | 'unconfigured';

/** Shown instead of the greeting while the LLM connector is unconfigured (#225). */
const OFFLINE_GREETING =
  'Buzz AI is currently inactive. Configure DICOMPUTE_API_KEY in your environment to enable chat.';

/** Carries the server's retryable flag alongside the clean error message. */
class BuzzRequestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'BuzzRequestError';
    this.retryable = retryable;
  }
}

export function BuzzAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connector, setConnector] = useState<ConnectorStatus>('unknown');
  const unconfigured = connector === 'unconfigured';

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm Buzz. I can help you manage and work with your Buzzbox operations. What would you like me to do?",
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Latest-status ref: the buzz:ask listener is registered once at mount, so
  // it reads this instead of the render's state -- otherwise a quick-action
  // dispatched while unconfigured would still fire a doomed request (#225).
  const unconfiguredRef = useRef(false);

  useEffect(() => {
    unconfiguredRef.current = unconfigured;
  }, [unconfigured]);

  // Pre-flight (#225): know whether the LLM connector is configured before
  // inviting the user to type. A failed probe leaves the status 'unknown' so
  // the composer stays usable and the server answers authoritatively instead
  // of locking chat behind a network hiccup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/buzz/status', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { isAiConfigured?: boolean };
        if (cancelled) return;
        setConnector(data?.isAiConfigured === false ? 'unconfigured' : 'ready');
      } catch {
        // Keep 'unknown' -- never block on a failed capability probe.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While unconfigured the greeting must not invite a chat that cannot work.
  useEffect(() => {
    if (connector !== 'unconfigured') return;
    setMessages(prev =>
      prev.length === 1 && prev[0].role === 'assistant'
        ? [{ ...prev[0], content: OFFLINE_GREETING }]
        : prev,
    );
  }, [connector]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
      });
    }
  }, [messages, loading, open]);

  // Listen for quick-action prompts dispatched from the dashboard
  // (sendMessage is stable enough for this fire-and-forget path; eslint-disable
  // avoids re-subscribing on every render.)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail;
      if (!detail?.prompt) return;
      setOpen(true);
      sendMessage(detail.prompt);
    };
    window.addEventListener('buzz:ask', handler);
    return () => window.removeEventListener('buzz:ask', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage(
    override?: string,
    options?: { resend?: boolean },
  ) {
    const message = (override ?? input).trim();

    // Unconfigured environments never reach the server: no user bubble, no
    // guaranteed failure in the thread -- the ref keeps this true even for
    // listeners captured before the status resolved (#225).
    if (!message || loading || unconfiguredRef.current) return;

    // A retry re-sends the SAME user text, so it is only appended to the
    // thread when it is a new message -- a failed exchange can therefore
    // never duplicate or corrupt the thread (#225).
    if (!options?.resend) {
      setInput('');

      setMessages(prev => [
        ...prev,
        {
          role: 'user',
          content: message,
        },
      ]);
    }

    setLoading(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch('/api/buzz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          message,
        }),
        signal: controller.signal,
      });

      // Error bodies are JSON, but a proxy/edge can answer HTML -- never let a
      // parse failure replace the real status message with a raw SyntaxError.
      const raw = await response.text();
      let data: {
        message?: string;
        error?: string;
        retryable?: boolean;
      } | null = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new BuzzRequestError(
          data?.error || `Request failed with status ${response.status}`,
          // Absent flag (older server) still means "worth retrying".
          data?.retryable !== false,
        );
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content:
            data?.message ||
            'I completed the request, but I did not receive a response.',
        },
      ]);
    } catch (error) {
      console.error('Buzz request failed:', error);

      const timedOut =
        (error as { name?: string } | null)?.name === 'AbortError';
      const unreachable = error instanceof TypeError;

      const content = timedOut
        ? 'Buzz took too long to respond.'
        : unreachable
          ? 'Buzz could not reach the server. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'Buzz ran into an unexpected error.';

      // Network/timeout failures are transient by definition; explicit server
      // answers carry their own retryable flag (config errors are not retryable).
      const retryable =
        error instanceof BuzzRequestError ? error.retryable : true;

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content,
          error: true,
          retryOf: message,
          retryable,
        },
      ]);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  /** Replace the failure bubble with a fresh attempt of the same message. */
  function handleRetry(index: number, retryOf?: string) {
    if (!retryOf || loading) return;

    setMessages(prev => prev.filter((_, i) => i !== index));
    void sendMessage(retryOf, { resend: true });
  }

  function handleDismiss(index: number) {
    setMessages(prev => prev.filter((_, i) => i !== index));
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function handleSuggestion(text: string) {
    setInput(text);
  }

  return (
    <div className="relative">
      {/* Buzz button */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className={`h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
          open
            ? 'bg-primary/15 text-primary border border-primary/30'
            : 'bg-surface-1 text-muted-foreground hover:text-foreground hover:bg-surface-2 border border-border'
        }`}
        aria-label="Open Buzz AI assistant"
        title="Buzz AI Assistant"
      >
        <Sparkles size={13} />

        <span className="hidden sm:inline">
          Buzz
        </span>
      </button>

      {/* Buzz panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] sm:w-[400px] h-[540px] card border shadow-2xl z-[100] overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center text-primary">
                <Bot size={16} />
              </div>

              <div>
                <div className="text-sm font-semibold text-foreground">
                  Buzz
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      unconfigured ? 'bg-destructive' : 'bg-success'
                    }`}
                  />
                  {unconfigured ? 'Unconfigured' : 'AI Assistant'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
              aria-label="Close Buzz"
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${
                  message.role === 'user'
                    ? 'justify-end'
                    : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[84%] rounded-xl px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : message.error
                        ? 'bg-destructive/10 border border-destructive/30 text-foreground rounded-bl-sm'
                        : 'bg-surface-1 border border-border text-foreground rounded-bl-sm'
                  }`}
                >
                  {message.content}

                  {message.error && (
                    <div className="mt-2 flex items-center gap-1.5">
                      {message.retryable !== false && (
                        <button
                          type="button"
                          onClick={() => handleRetry(index, message.retryOf)}
                          disabled={loading}
                          aria-label="Retry"
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50 text-[11px] font-medium"
                        >
                          <RotateCcw size={11} />
                          Retry
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDismiss(index)}
                        disabled={loading}
                        className="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface-1 border border-border rounded-xl rounded-bl-sm px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2
                      size={13}
                      className="animate-spin"
                    />
                    Buzz is thinking...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 1 && !unconfigured && (
            <div className="px-3 pb-2">
              <div className="text-[10px] text-muted-foreground mb-1.5 px-1">
                Try asking Buzz
              </div>

              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() =>
                    handleSuggestion(
                      "Give me today's marketing overview",
                    )
                  }
                  className="whitespace-nowrap px-2.5 py-1.5 rounded-lg bg-surface-1 border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                >
                  Today&apos;s overview
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleSuggestion(
                      'Show me the current pipeline',
                    )
                  }
                  className="whitespace-nowrap px-2.5 py-1.5 rounded-lg bg-surface-1 border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                >
                  Pipeline
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleSuggestion(
                      'Show me pending approvals',
                    )
                  }
                  className="whitespace-nowrap px-2.5 py-1.5 rounded-lg bg-surface-1 border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                >
                  Approvals
                </button>
              </div>
            </div>
          )}

          {/* Unconfigured warning (#225): say how to fix it instead of letting
              a guaranteed failure into the transcript */}
          {unconfigured && (
            <div
              role="status"
              className="mx-3 mb-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 space-y-1"
            >
              <div className="text-[11px] font-semibold text-warning">
                Buzz AI is currently inactive.
              </div>

              <div className="text-[10px] text-muted-foreground leading-relaxed">
                Set DICOMPUTE_API_KEY in your environment to enable chat.
                Optionally set OLLAMA_BASE_URL to keep a local Ollama
                fallback, then restart Buzzbox.
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-border bg-surface-0">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={event =>
                  setInput(event.target.value)
                }
                onKeyDown={handleKeyDown}
                disabled={loading || unconfigured}
                placeholder="Ask Buzz anything..."
                className="flex-1 h-9 px-3 rounded-lg bg-surface-1 border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
              />

              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading || unconfigured}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <Send size={14} />
              </button>
            </div>

            <div className="text-[9px] text-muted-foreground mt-2 text-center">
              Powered by Qwen 2.5 7B · DICOMPUTE
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
