'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { toast } from '@/components/ui/toast';
import { useDashboard } from '@/store';
import { CheckCircle2, XCircle, Mail, PenLine, ShieldCheck } from 'lucide-react';

interface ContentApproval {
  id: string;
  platform: string;
  format: string;
  pillar: number | null;
  text_preview: string | null;
  full_content: string | null;
  status: string;
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
  image_url: string | null;
}

interface SequenceApproval {
  id: string;
  lead_id: string | null;
  sequence_name: string | null;
  step: number | null;
  subject: string | null;
  body: string | null;
  status: string | null;
  tier: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
}

interface ApprovalData {
  content: ContentApproval[];
  sequences: SequenceApproval[];
  total: number;
}

interface ApprovalHistory {
  ts: string;
  action: string;
  detail: string;
  result?: string | null;
}

interface AuthMe {
  user?: { id: number; username: string; role: string };
}

export default function ApprovalsPage() {
  const { realOnly } = useDashboard();
  const realParam = realOnly ? '?real=true' : '';
  const [acting, setActing] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);

  const { data, refetch } = useSmartPoll<ApprovalData>(
    () => fetch(`/api/approvals${realParam}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  const { data: historyData } = useSmartPoll<{ history: ApprovalHistory[] }>(
    () => fetch('/api/approvals/history').then(r => r.json()),
    { interval: 30_000 },
  );

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(setAuth)
      .catch(() => setAuth(null));
  }, []);

  const content = data?.content || [];
  const sequences = data?.sequences || [];
  const history = historyData?.history || [];

  const canBulkApprove = useMemo(() => auth?.user?.role === 'admin', [auth]);

  async function updateContent(id: string, status: 'ready' | 'rejected') {
    setActing(id);
    try {
      await fetch('/api/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      toast.success(status === 'ready' ? 'Content approved' : 'Content rejected');
      refetch();
    } catch {
      toast.error('Failed to update content');
    } finally {
      setActing(null);
    }
  }

  async function updateSequence(id: string, status: 'approved' | 'cancelled') {
    setActing(id);
    try {
      await fetch('/api/sequences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      toast.success(status === 'approved' ? 'Sequence approved' : 'Sequence rejected');
      refetch();
    } catch {
      toast.error('Failed to update sequence');
    } finally {
      setActing(null);
    }
  }

  async function approveAllContent() {
    if (!canBulkApprove || content.length === 0) return;
    if (!confirm(`Approve all ${content.length} content drafts?`)) return;
    setBulkWorking(true);
    try {
      await Promise.all(
        content.map(item =>
          fetch('/api/content', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, status: 'ready' }),
          }),
        ),
      );
      toast.success('All content drafts approved');
      refetch();
    } catch {
      toast.error('Failed to approve all content');
    } finally {
      setBulkWorking(false);
    }
  }

  async function approveAllSequences() {
    if (!canBulkApprove || sequences.length === 0) return;
    if (!confirm(`Approve all ${sequences.length} outreach drafts?`)) return;
    setBulkWorking(true);
    try {
      await Promise.all(
        sequences.map(item =>
          fetch('/api/sequences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, status: 'approved' }),
          }),
        ),
      );
      toast.success('All outreach drafts approved');
      refetch();
    } catch {
      toast.error('Failed to approve all outreach');
    } finally {
      setBulkWorking(false);
    }
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="panel">
        <div className="panel-header flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold">Approvals</h1>
            <p className="text-sm text-muted-foreground">Review pending content drafts and outreach sequences</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="status-pill status-neutral">Total: {data?.total ?? 0}</span>
            <span className="status-pill status-info">Content: {content.length}</span>
            <span className="status-pill status-warn">Outreach: {sequences.length}</span>
            {canBulkApprove && (
              <span className="status-pill status-ok flex items-center gap-1">
                <ShieldCheck size={12} /> Admin
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title flex items-center gap-2">
              <PenLine size={14} /> Content Drafts
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{content.length} pending</span>
              <button
                className="btn btn-xs bg-success/15 text-success hover:bg-success/25"
                disabled={!canBulkApprove || bulkWorking || content.length === 0}
                onClick={approveAllContent}
                title={canBulkApprove ? 'Approve all content' : 'Admin only'}
              >
                Approve all
              </button>
            </div>
          </div>
          {content.length === 0 ? (
            <div className="text-xs text-muted-foreground">No pending content approvals.</div>
          ) : (
            <div className="space-y-3">
              {content.map(item => (
                <div key={item.id} className="p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">
                        {item.text_preview || item.full_content?.slice(0, 80) || 'Untitled draft'}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {item.platform} · {item.format}{item.pillar ? ` · Pillar ${item.pillar}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-sm bg-success/15 text-success hover:bg-success/25"
                        disabled={acting === item.id}
                        onClick={() => updateContent(item.id, 'ready')}
                      >
                        <CheckCircle2 size={12} /> Approve
                      </button>
                      <button
                        className="btn btn-sm bg-destructive/15 text-destructive hover:bg-destructive/25"
                        disabled={acting === item.id}
                        onClick={() => updateContent(item.id, 'rejected')}
                      >
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title flex items-center gap-2">
              <Mail size={14} /> Outreach Sequences
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{sequences.length} pending</span>
              <button
                className="btn btn-xs bg-success/15 text-success hover:bg-success/25"
                disabled={!canBulkApprove || bulkWorking || sequences.length === 0}
                onClick={approveAllSequences}
                title={canBulkApprove ? 'Approve all outreach' : 'Admin only'}
              >
                Approve all
              </button>
            </div>
          </div>
          {sequences.length === 0 ? (
            <div className="text-xs text-muted-foreground">No pending outreach approvals.</div>
          ) : (
            <div className="space-y-3">
              {sequences.map(item => (
                <div key={item.id} className="p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">
                        {item.subject || `Sequence step ${item.step ?? 1}`}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {[item.first_name, item.last_name].filter(Boolean).join(' ') || 'Unknown lead'}
                        {item.company ? ` · ${item.company}` : ''}
                        {item.tier ? ` · Tier ${item.tier}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-sm bg-success/15 text-success hover:bg-success/25"
                        disabled={acting === item.id}
                        onClick={() => updateSequence(item.id, 'approved')}
                      >
                        <CheckCircle2 size={12} /> Approve
                      </button>
                      <button
                        className="btn btn-sm bg-destructive/15 text-destructive hover:bg-destructive/25"
                        disabled={acting === item.id}
                        onClick={() => updateSequence(item.id, 'cancelled')}
                      >
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Recent approvals</h2>
          <span className="text-[10px] text-muted-foreground">{history.length} events</span>
        </div>
        {history.length === 0 ? (
          <div className="text-xs text-muted-foreground">No recent approval activity.</div>
        ) : (
          <div className="space-y-2 text-xs">
            {history.map((item, idx) => (
              <div key={`${item.ts}-${idx}`} className="flex items-start justify-between gap-4 border-b border-border/40 pb-2">
                <div>
                  <div className="font-medium">{item.action.replace(/_/g, ' ')}</div>
                  <div className="text-muted-foreground">{item.detail}</div>
                </div>
                <div className="text-right text-muted-foreground whitespace-nowrap">
                  {new Date(item.ts).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
