'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles, Loader2 } from 'lucide-react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export function BuzzAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm Buzz. I can help you manage and work with your Buzzbox operations. What would you like me to do?",
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
      });
    }
  }, [messages, loading, open]);

  async function sendMessage() {
    const message = input.trim();

    if (!message || loading) return;

    setInput('');

    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: message,
      },
    ]);

    setLoading(true);

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
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || `Request failed with status ${response.status}`,
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

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content:
            error instanceof Error
              ? `I ran into an error: ${error.message}`
              : 'I ran into an unexpected error.',
        },
      ]);
    } finally {
      setLoading(false);
    }
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
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  AI Assistant
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
                      : 'bg-surface-1 border border-border text-foreground rounded-bl-sm'
                  }`}
                >
                  {message.content}
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
          {messages.length === 1 && (
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

          {/* Input */}
          <div className="p-3 border-t border-border bg-surface-0">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={event =>
                  setInput(event.target.value)
                }
                onKeyDown={handleKeyDown}
                disabled={loading}
                placeholder="Ask Buzz anything..."
                className="flex-1 h-9 px-3 rounded-lg bg-surface-1 border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
              />

              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
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

