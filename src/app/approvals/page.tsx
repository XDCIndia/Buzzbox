'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { toast } from '@/components/ui/toast';
import { useDashboard } from '@/store';
import { CheckCircle2, XCircle, Mail, PenLine, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

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
      const res = await fetch('/api/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(String(data?.error || `Request failed (${res.status})`));
      }
      toast.success(status === 'ready' ? 'Content approved' : 'Content rejected');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to update content');
    } finally {
      setActing(null);
    }
  }

  async function updateSequence(id: string, status: 'approved' | 'cancelled') {
    setActing(id);
    try {
      const res = await fetch('/api/sequences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(String(data?.error || `Request failed (${res.status})`));
      }
      toast.success(status === 'approved' ? 'Sequence approved' : 'Sequence rejected');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to update sequence');
    } finally {
      setActing(null);
    }
  }

  async function approveAllContent() {
    if (!canBulkApprove || content.length === 0) return;
    if (!confirm(`Approve all ${content.length} content drafts?`)) return;
    setBulkWorking(true);
    try {
      const results = await Promise.all(
        content.map(item =>
          fetch('/api/content', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, status: 'ready' }),
          }),
        ),
      );
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        throw new Error(`${failed.length} of ${results.length} approvals failed`);
      }
      toast.success('All content drafts approved');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to approve all content');
    } finally {
      setBulkWorking(false);
    }
  }

  async function approveAllSequences() {
    if (!canBulkApprove || sequences.length === 0) return;
    if (!confirm(`Approve all ${sequences.length} outreach drafts?`)) return;
    setBulkWorking(true);
    try {
      const results = await Promise.all(
        sequences.map(item =>
          fetch('/api/sequences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, status: 'approved' }),
          }),
        ),
      );
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        throw new Error(`${failed.length} of ${results.length} approvals failed`);
      }
      toast.success('All outreach drafts approved');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to approve all outreach');
    } finally {
      setBulkWorking(false);
    }
  }

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="03"
        eyebrow="Operate"
        title="Approvals"
        description="Review pending content drafts and outreach sequences"
      >
        <span className="status-pill status-neutral">Total: {data?.total ?? 0}</span>
        <span className="status-pill status-info">Content: {content.length}</span>
        <span className="status-pill status-warn">Outreach: {sequences.length}</span>
        {canBulkApprove && (
          <span className="status-pill status-ok flex items-center gap-1">
            <ShieldCheck size={12} /> Admin
          </span>
        )}
      </PageHeader>

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
            <EmptyState
              icon={PenLine}
              title="No content waiting"
              reason="Drafts flagged for review appear here before anything is scheduled or published."
              next="New drafts from the content pipeline will show up automatically."
              variant="inline"
            />
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
            <EmptyState
              icon={Mail}
              title="No outreach waiting"
              reason="Sequence steps generated for leads queue here for a quick approve/reject."
              next="They arrive automatically as new leads enter the pipeline."
              variant="inline"
            />
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
          <EmptyState
            icon={ShieldCheck}
            title="No approvals yet"
            reason="Approved and rejected items are logged here with who acted and when."
            variant="inline"
          />
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
