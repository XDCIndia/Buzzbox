'use client';

import { useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';
import Link from 'next/link';

interface SessionInfo {
  agent_id: string;
  session_id: string;
  conversation_id: string;
  message_count: number;
  last_message_at: number;
  first_message_at: number;
  preview?: string;
}

export function AgentSessions() {
  const [expanded, setExpanded] = useState(false);

  const { data } = useSmartPoll<{ sessions: SessionInfo[] }>(
    () => fetch('/api/chat/sessions').then(r => r.json()),
    { interval: 30_000 },
  );

  const sessions = data?.sessions || [];
  if (sessions.length === 0) return null;

  const AGENT_THEME: Record<string, { emoji: string; color: string; bg: string }> = {
    hermes: { emoji: '\u{1F3DB}\u{FE0F}', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    apollo: { emoji: '\u{1F3AF}', color: 'text-blue-400', bg: 'bg-blue-500/10' },
    athena: { emoji: '\u{1F9E0}', color: 'text-purple-400', bg: 'bg-purple-500/10' },
    metis: { emoji: '\u{1F4CA}', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  };

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-chart-4/10 flex items-center justify-center">
            <Terminal size={16} className="text-chart-4" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-sm">Agent Sessions</h3>
            <p className="text-[11px] text-muted-foreground">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/30 divide-y divide-border/20">
          {sessions.map(session => {
            const theme = AGENT_THEME[session.agent_id] || { emoji: '\u{1F916}', color: 'text-muted-foreground', bg: 'bg-muted/10' };
            return (
              <div key={session.conversation_id} className="px-5 py-3 flex items-center gap-3">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${theme.bg} ${theme.color}`}>
                  {theme.emoji} {session.agent_id}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">
                    {session.preview || `Session ${session.session_id.slice(0, 8)}...`}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {session.message_count} turns · {timeAgo(new Date(session.last_message_at * 1000).toISOString())}
                  </div>
                </div>
                <Link
                  href={`/agents/comms?conv=${encodeURIComponent(session.conversation_id)}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink size={14} />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
