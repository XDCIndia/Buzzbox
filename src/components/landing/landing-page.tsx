'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, ArrowDown, Boxes, Copy, Check, ChevronDown, Users, Mail,
  PenLine, BarChart3, Search, Bot, Zap, CheckSquare, Plug, Database, Lock,
  KeyRound, Twitter, Linkedin, Send, MessageSquare, Globe, Youtube,
  Terminal,
} from 'lucide-react';
import './landing.css';

/* ─── Scroll reveal ─────────────────────────────────────── */

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.lp .reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ─── Module catalog ────────────────────────────────────── */

type ModuleCategory = 'growth' | 'content' | 'intelligence' | 'control';

const MODULES: {
  name: string;
  id: string;
  href: string;
  category: ModuleCategory;
  icon: typeof Users;
  rows: [string, string][];
}[] = [
  {
    name: 'CRM', id: '/crm', href: '/crm', category: 'growth', icon: Users,
    rows: [['Pipeline', 'stages & tiers'], ['Sources', 'trend tracking'], ['Lead quality', 'AI scored']],
  },
  {
    name: 'Outreach', id: '/outreach', href: '/outreach', category: 'growth', icon: Mail,
    rows: [['Sequences', 'multi-step'], ['Suppression', 'built-in'], ['Engagement', 'tracked']],
  },
  {
    name: 'Content', id: '/content', href: '/content', category: 'content', icon: PenLine,
    rows: [['Calendar', 'plan & schedule'], ['Approvals', 'review queue'], ['Performance', 'per item']],
  },
  {
    name: 'Research', id: '/research', href: '/research', category: 'intelligence', icon: Search,
    rows: [['Signals', 'daily harvest'], ['Sources', 'X · Reddit · news'], ['Memory', 'shared brain']],
  },
  {
    name: 'Analytics', id: '/analytics', href: '/analytics', category: 'intelligence', icon: BarChart3,
    rows: [['KPIs', 'daily rollups'], ['Connectors', 'Plausible · GA4'], ['Benchmarks', 'cycle time']],
  },
  {
    name: 'Agents', id: '/agents', href: '/agents/squads', category: 'control', icon: Bot,
    rows: [['Squads', 'composable'], ['Sessions', 'live view'], ['Workspace', 'sandboxed']],
  },
  {
    name: 'Automations', id: '/automations', href: '/automations', category: 'control', icon: Zap,
    rows: [['Cron', 'native scheduler'], ['Templates', 'reusable'], ['Deploys', 'status board']],
  },
  {
    name: 'Approvals', id: '/approvals', href: '/approvals', category: 'control', icon: CheckSquare,
    rows: [['Queue', 'human gate'], ['Audit', 'every action'], ['RBAC', 'admin · editor · viewer']],
  },
  {
    name: 'Integrations', id: '/integrations', href: '/integrations', category: 'control', icon: Plug,
    rows: [['Providers', 'Google · X · Reddit'], ['Webhooks', 'API-keyed'], ['Ollama', 'local models']],
  },
];

const CATEGORY_LABELS: Record<ModuleCategory | 'all', string> = {
  all: 'All modules',
  growth: 'Growth',
  content: 'Content',
  intelligence: 'Intelligence',
  control: 'Control',
};

/* ─── Code samples ──────────────────────────────────────── */

const CURL_CODE = (
  <>
    <span className="tok-kw">curl</span> -X POST https://your-buzzbox.host/api/sequences/12/trigger {'\n'}
    {'  '}-H <span className="tok-str">&quot;x-api-key: $BUZZBOX_API_KEY&quot;</span> {'\n'}
    {'  '}-H <span className="tok-str">&quot;Content-Type: application/json&quot;</span>
  </>
);

const PYTHON_CODE = (
  <>
    <span className="tok-kw">import</span> os, requests{'\n'}
    {'\n'}
    resp = requests.post({'\n'}
    {'    '}<span className="tok-str">&quot;https://your-buzzbox.host/api/webhook/telegram&quot;</span>,{'\n'}
    {'    '}headers={'{'}<span className="tok-str">&quot;x-api-key&quot;</span>: os.environ[<span className="tok-str">&quot;BUZZBOX_API_KEY&quot;</span>]{'}'},{'\n'}
    {'    '}json={'{'}{'\n'}
    {'        '}<span className="tok-str">&quot;type&quot;</span>: <span className="tok-str">&quot;lead_reply&quot;</span>,{'\n'}
    {'        '}<span className="tok-str">&quot;title&quot;</span>: <span className="tok-str">&quot;Hot lead replied&quot;</span>,{'\n'}
    {'        '}<span className="tok-str">&quot;severity&quot;</span>: <span className="tok-str">&quot;info&quot;</span>,{'\n'}
    {'    '}{'}'},{'\n'}
    ){'}'}
    {'\n'}
    <span className="tok-kw">print</span>(resp.json())
  </>
);

const TS_CODE = (
  <>
    <span className="tok-kw">const</span> res = <span className="tok-kw">await</span> fetch({'\n'}
    {'  '}<span className="tok-str">&quot;https://your-buzzbox.host/api/crm/leads&quot;</span>,{'\n'}
    {'  '}{'{'}{'\n'}
    {'    '}method: <span className="tok-str">&quot;POST&quot;</span>,{'\n'}
    {'    '}headers: {'{'} <span className="tok-str">&quot;x-api-key&quot;</span>: process.env.<span className="tok-flag">BUZZBOX_API_KEY</span>! {'}'},{'\n'}
    {'    '}body: <span className="tok-flag">JSON</span>.stringify({'{'}{'\n'}
    {'      '}name: <span className="tok-str">&quot;Acme Corp&quot;</span>,{'\n'}
    {'      '}source: <span className="tok-str">&quot;reddit&quot;</span>,{'\n'}
    {'      '}tier: <span className="tok-str">&quot;hot&quot;</span>,{'\n'}
    {'    '}{'}'}),{'\n'}
    {'  '}{'}'},{'\n'}
    );{'\n'}
    <span className="tok-flag">console</span>.log(<span className="tok-kw">await</span> res.json());
  </>
);

const CODE_TABS = [
  { id: 'curl', label: 'cURL', code: CURL_CODE },
  { id: 'python', label: 'Python', code: PYTHON_CODE },
  { id: 'ts', label: 'TypeScript', code: TS_CODE },
] as const;

/* ─── FAQ ───────────────────────────────────────────────── */

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Does Buzzbox need a cloud account?',
    a: <>No. The app, authentication, and all state run on your machine or a private host in a single SQLite file. Optional connectors for X, LinkedIn, Reddit, Gmail, Plausible, and GA4 are the only outbound pieces, and each one is opt-in.</>,
  },
  {
    q: 'What do the AI agents actually do?',
    a: <>Agents work through squads: research signals, draft content, run outreach steps, and file approvals. Every scheduled job respects per-channel budgets and rate limits, and their actions land in the same activity ledger as human edits.</>,
  },
  {
    q: 'Can agents post or send without my approval?',
    a: <>Only if you say so. Write paths — posts, sends, lead updates — are gated behind role-based access and explicit <code>HERMES_ALLOW_*_WRITE</code> flags that ship disabled. Until you flip one, agents can only prepare work.</>,
  },
  {
    q: 'How is my data stored?',
    a: <>Everything lives in <code>state/hermes.db</code>, a local SQLite database you can back up, inspect, or move. Provider credentials are read from server-side environment variables and never reach the browser.</>,
  },
  {
    q: 'Can I script or integrate with it?',
    a: <>Yes. The same API-keyed endpoints the UI uses are available to your code and CI: create leads, trigger sequences, post webhook events, and read analytics. See the developer section above for examples.</>,
  },
  {
    q: 'What happens if I turn everything off?',
    a: <>Buzzbox keeps working as a read-only control room. Dashboards, queues, and history stay intact; nothing goes out and nothing changes. You can re-enable individual write paths whenever you are ready.</>,
  },
];

/* ─── Page ──────────────────────────────────────────────── */

export function LandingPage() {
  useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<(typeof CODE_TABS)[number]['id']>('curl');
  const [copied, setCopied] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [filter, setFilter] = useState<ModuleCategory | 'all'>('all');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const activeTab = CODE_TABS.find((t) => t.id === tab) ?? CODE_TABS[0];
  const visibleModules = filter === 'all' ? MODULES : MODULES.filter((m) => m.category === filter);

  const copyCode = async () => {
    const text = document.querySelector('.lp-code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="lp">
      {/* ── Header ─────────────────────────────────────── */}
      <header className={`lp-header${scrolled ? ' scrolled' : ''}`}>
        <div className="wrap lp-header-inner">
          <Link href="/" className="lp-logo" aria-label="Buzzbox home">
            <span className="lp-logo-mark"><Boxes className="h-4 w-4" /></span>
            <span className="lp-logo-word">Buzz<span>box</span></span>
          </Link>
          <nav className="lp-nav" aria-label="Primary">
            <a href="#platform">Platform</a>
            <a href="#modules">Modules</a>
            <a href="#developers">Developers</a>
            <a href="#security">Security</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-header-ctas">
            <Link href="/login" className="login">Log in</Link>
            <Link href="/dashboard" className="btn btn-primary">
              Open the dashboard
              <ArrowRight className="arrow h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────── */}
      <section className="lp-hero" id="top" aria-labelledby="lp-hero-title">
        <div className="wrap lp-hero-grid">
          <div>
            <p className="eyebrow reveal">The local-first growth command center</p>
            <h1 className="h1 reveal r2" id="lp-hero-title">
              Run marketing like<br />
              <span className="accent">an engineering product.</span>
            </h1>
            <p className="lede reveal r3">
              Buzzbox puts your CRM, outreach, content, agents, and analytics in one
              self-hosted cockpit. Agents do the busywork — you keep the pen.
            </p>
            <div className="reveal r4" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
              <Link href="/dashboard" className="btn btn-primary">
                Open the dashboard
                <ArrowRight className="arrow h-4 w-4" />
              </Link>
              <a href="#platform" className="btn btn-ghost">
                See how it works
                <ArrowDown className="down h-4 w-4" />
              </a>
            </div>
            <ul className="lp-hero-points reveal r5" aria-label="Key facts">
              <li>Local-first</li>
              <li>Human-in-the-loop</li>
              <li>API &amp; webhook ready</li>
            </ul>
          </div>

          {/* Diagram */}
          <div
            className="lp-diagram reveal r3"
            role="img"
            aria-label="System concept: your team and agent workflows send signals into one Buzzbox system, which routes work to CRM, outreach, and content modules. Illustrative, not live telemetry."
          >
            <span className="lp-diagram-label">System concept</span>
            <svg className="edges" viewBox="0 0 600 460" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <g className="edge">
                <path d="M48 138H150Q170 138 170 158V205Q170 225 190 225H282" />
                <path d="M48 313H150Q170 313 170 293V245Q170 225 190 225H282" />
                <path d="M282 225H360Q380 225 380 205V121Q380 101 400 101H516" />
                <path d="M282 225H516" />
                <path d="M282 225H360Q380 225 380 245V330Q380 350 400 350H516" />
              </g>
              <path className="flow" pathLength="100" d="M48 138H150Q170 138 170 158V205Q170 225 190 225H282" />
              <path className="flow d1" pathLength="100" d="M282 225H360Q380 225 380 245V330Q380 350 400 350H516" />
            </svg>
            <div className="lp-node lp-node-one">
              <span className="nicon"><Users className="h-3.5 w-3.5" /></span>
              Your team
            </div>
            <div className="lp-node lp-node-two">
              <span className="nicon"><Terminal className="h-3.5 w-3.5" /></span>
              Agent workflows
            </div>
            <div className="lp-hub">
              <span className="hub-symbol">b<span>x</span></span>
              <span className="hub-label">ONE SYSTEM</span>
            </div>
            <div className="lp-node lp-worker lp-worker-one">
              <span className="nicon"><Users className="h-3.5 w-3.5" /></span>
              <span>CRM<span className="lp-node-sub">Leads &amp; pipeline</span></span>
            </div>
            <div className="lp-node lp-worker lp-worker-two">
              <span className="nicon"><Mail className="h-3.5 w-3.5" /></span>
              <span>Outreach<span className="lp-node-sub">Sequences &amp; sends</span></span>
            </div>
            <div className="lp-node lp-worker lp-worker-three">
              <span className="nicon"><PenLine className="h-3.5 w-3.5" /></span>
              <span>Content<span className="lp-node-sub">Calendar &amp; drafts</span></span>
            </div>
            <div className="lp-diagram-bottom mono">SIGNAL → PLAN → APPROVE → EXECUTE → MEASURE</div>
          </div>
        </div>
      </section>

      {/* ── Proof strip ────────────────────────────────── */}
      <section className="lp-proof" aria-label="Works with your tools">
        <div className="wrap lp-proof-inner">
          <p className="lp-proof-title"><strong>Connects to the tools you already run</strong> — all optional, all server-side</p>
          {[
            [Twitter, 'X / Twitter'],
            [Linkedin, 'LinkedIn'],
            [MessageSquare, 'Reddit'],
            [Mail, 'Gmail & Mailchimp'],
            [Send, 'Telegram'],
            [BarChart3, 'Plausible'],
            [Youtube, 'YouTube'],
            [Globe, 'GA4 & Sanity'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Twitter;
            return (
              <span className="lp-chip" key={label as string}>
                <I className="h-3.5 w-3.5" />
                {label as string}
              </span>
            );
          })}
        </div>
      </section>

      {/* ── 01 / Platform ──────────────────────────────── */}
      <section className="lp-section" id="platform" aria-labelledby="lp-platform-title">
        <div className="wrap">
          <div className="lp-section-head">
            <div>
              <p className="num reveal">01 / The platform</p>
              <h2 className="h2 reveal r2" id="lp-platform-title">One cockpit.<br />Every channel.</h2>
            </div>
            <p className="lede reveal r3">
              Marketing work scattered across ten tabs is work you can&apos;t measure.
              Buzzbox turns it into one operating loop: signal in, plan next, human
              approves, agents execute, numbers come back.
            </p>
          </div>
          <div className="lp-cards-3">
            <div className="lp-card reveal">
              <div className="glyph"><Zap className="h-5 w-5" /></div>
              <h3 className="h3">Agents do the busywork.</h3>
              <p>
                Squads of AI agents research, draft, and execute across channels on a
                schedule — with per-channel budgets and rate limits enforced server-side.
              </p>
              <a className="link-arrow" href="#modules">See the modules <ArrowRight className="h-3.5 w-3.5" /></a>
            </div>
            <div className="lp-card reveal r2">
              <div className="glyph"><CheckSquare className="h-5 w-5" /></div>
              <h3 className="h3">Humans keep the pen.</h3>
              <p>
                Every write path — posts, sends, lead updates — pauses for approval
                unless you explicitly flip it on. Approval stays operator-led, never hidden.
              </p>
              <a className="link-arrow" href="#security">Read the boundaries <ArrowRight className="h-3.5 w-3.5" /></a>
            </div>
            <div className="lp-card reveal r3">
              <div className="glyph"><GaugeBadge /></div>
              <h3 className="h3">Measure what moves.</h3>
              <p>
                KPIs, cycle-time benchmarks, and engagement roll up from real activity —
                leads, sends, and posts — not vanity metrics bolted on afterwards.
              </p>
              <a className="link-arrow" href="#developers">Explore the API <ArrowRight className="h-3.5 w-3.5" /></a>
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 / Modules ───────────────────────────────── */}
      <section className="lp-section lp-section-pale" id="modules" aria-labelledby="lp-modules-title">
        <div className="wrap">
          <div className="lp-section-head">
            <div>
              <p className="num reveal">02 / The modules</p>
              <h2 className="h2 reveal r2" id="lp-modules-title">Small tools.<br />Serious leverage.</h2>
            </div>
            <p className="lede reveal r3">
              Nine focused surfaces, one shared memory. Evaluate each one on your own
              workflow before wiring agents into it.{' '}
              <a className="link-arrow" href="/dashboard">Open the control center <ArrowRight className="h-3.5 w-3.5" /></a>
            </p>
          </div>

          <div className="lp-filter-row" role="group" aria-label="Filter modules">
            {(Object.keys(CATEGORY_LABELS) as (ModuleCategory | 'all')[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`lp-filter${filter === k ? ' active' : ''}`}
                onClick={() => setFilter(k)}
              >
                {CATEGORY_LABELS[k]}
              </button>
            ))}
          </div>

          <div className="lp-cards-mods">
            {visibleModules.map((m) => {
              const I = m.icon;
              return (
                <article className="lp-card" key={m.id}>
                  <div className="lp-mod-top">
                    <span className="lp-mod-icon"><I className="h-4.5 w-4.5" /></span>
                    <span className={`lp-pill lp-pill-${m.category}`}>{CATEGORY_LABELS[m.category]}</span>
                  </div>
                  <h3 className="h3">{m.name}</h3>
                  <p className="lp-mod-id mono">{m.id}</p>
                  <p className="muted" style={{ fontSize: '0.92rem', margin: 0 }}>{MODULE_BLURBS[m.id]}</p>
                  <div className="lp-mod-rows">
                    {m.rows.map(([k, v]) => (
                      <div className="lp-mod-row" key={k}>
                        <span className="k">{k}</span>
                        <span className="v">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <Link className="link-arrow" href={m.href}>Open in dashboard <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="lp-aside-note reveal">
            Also inside: an engagement inbox, experiments, memory health, KPI boards, a
            cron console, and a deploy guard — all versioned in{' '}
            <code>state/hermes.db</code>, a single SQLite file you own.
          </p>
        </div>
      </section>

      {/* ── 03 / Developers ────────────────────────────── */}
      <section className="lp-section" id="developers" aria-labelledby="lp-dev-title">
        <div className="wrap lp-dev-grid">
          <div>
            <p className="num reveal">03 / Built for builders</p>
            <h2 className="h2 reveal r2" id="lp-dev-title">A familiar dashboard.<br />An open loop.</h2>
            <p className="lede reveal r3" style={{ marginTop: 16 }}>
              Drive Buzzbox from code with the same API-keyed endpoints the UI uses.
              Automate the parts of the loop you want automated.
            </p>
            <ol className="lp-steps">
              <li className="lp-step reveal">
                <span className="lp-step-n">01</span>
                <div>
                  <strong>Create an API key</strong>
                  <p>Generate it in Settings and keep it server-side — the browser never holds it.</p>
                </div>
              </li>
              <li className="lp-step reveal r2">
                <span className="lp-step-n">02</span>
                <div>
                  <strong>Point your client at /api</strong>
                  <p>Session cookie for humans, <span className="mono">x-api-key</span> for machines. Same routes, same rules.</p>
                </div>
              </li>
              <li className="lp-step reveal r3">
                <span className="lp-step-n">03</span>
                <div>
                  <strong>Automate the loop</strong>
                  <p>Create leads, trigger sequences, and ship webhook events from cron, CI, or agents.</p>
                </div>
              </li>
            </ol>
            <Link className="link-arrow reveal r4" href="/settings">Open Settings <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>

          <div className="reveal r3">
            <div className="lp-codecard">
              <div className="lp-code-top">
                <div className="lp-code-tabs" role="tablist" aria-label="Code language">
                  {CODE_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      className={`lp-code-tab${tab === t.id ? ' active' : ''}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="lp-copy-btn" onClick={copyCode}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="lp-code">{activeTab.code}</pre>
            </div>
            <p className="lp-code-note">
              Server-side examples — keep the key on your server. Every route and knob is
              documented in <code>.env.example</code> and <code>SECURITY.md</code>.
            </p>
          </div>
        </div>
      </section>

      {/* ── 04 / Trust (dark) ──────────────────────────── */}
      <section className="lp-section lp-dark" id="security" aria-labelledby="lp-trust-title">
        <div className="wrap">
          <div className="lp-section-head">
            <div>
              <p className="num reveal">04 / The foundations</p>
              <h2 className="h2 reveal r2" id="lp-trust-title">Local by default.<br />Guarded by design.</h2>
            </div>
            <p className="lede reveal r3">
              Start with a read-only posture, verify each boundary, and enable writes
              only for operations you intend to expose.
            </p>
          </div>

          <div className="lp-trust-grid">
            <div className="lp-trust-card reveal">
              <div className="glyph"><Database className="h-5 w-5" /></div>
              <h3 className="h3">Your data stays home.</h3>
              <p>
                The app, auth, and all state run on your machine or private host in one
                SQLite file. No vendor cloud in the critical path, ever.
              </p>
            </div>
            <div className="lp-trust-card reveal r2">
              <div className="glyph"><Lock className="h-5 w-5" /></div>
              <h3 className="h3">Approvals stay human.</h3>
              <p>
                Writeback paths sit behind RBAC and <span className="mono" style={{ fontSize: '0.82em' }}>HERMES_ALLOW_*_WRITE</span> flags
                that ship disabled — and every action lands in the audit trail.
              </p>
            </div>
            <div className="lp-trust-card reveal r3">
              <div className="glyph"><KeyRound className="h-5 w-5" /></div>
              <h3 className="h3">Secrets stay server-side.</h3>
              <p>
                Provider credentials load from env vars or your secret manager. Host
                locking keeps deployments to localhost, Tailscale, or your allowlist.
              </p>
            </div>
          </div>

          <div className="lp-envstrip reveal r2">
            <pre>
AUTH_USER=<span className="val">admin</span>            <span className="eq"># your login</span>{'\n'}
AUTH_PASS=<span className="val">••••••••••</span>        <span className="eq"># min 10 chars — replace the seed</span>{'\n'}
API_KEY=<span className="val">••••••••••</span>          <span className="eq"># machine access via x-api-key</span>{'\n'}
HERMES_HOST_LOCK=<span className="val">local</span>     <span className="eq"># localhost + tailscale only</span>
            </pre>
            <p className="cap"><Lock className="h-3.5 w-3.5" /> Start read-only. Enable writes only where you mean to.</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────── */}
      <section className="lp-section lp-section-pale" id="faq" aria-labelledby="lp-faq-title">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <p className="num reveal">05 / Questions</p>
            <h2 className="h2 reveal r2" id="lp-faq-title">Asked, answered, audited.</h2>
          </div>
          <div className="lp-faq">
            {FAQ_ITEMS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div className={`lp-faq-item${open ? ' open' : ''}`} key={item.q}>
                  <button
                    type="button"
                    className="lp-faq-q"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    {item.q}
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <div className="lp-faq-a" aria-hidden={!open}>
                    <div className="lp-faq-a-inner"><p>{item.a}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Closing ────────────────────────────────────── */}
      <section className="lp-closing" aria-labelledby="lp-closing-title">
        <div className="wrap">
          <p className="eyebrow reveal" style={{ justifyContent: 'center' }}>Your cockpit is already built</p>
          <h2 className="h2 reveal r2" id="lp-closing-title">Run the loop.<br />Own the machine.</h2>
          <p className="reveal r3">
            Clone it, seed it, log in. Buzzbox ships with the whole control center —
            and the off switch is always yours.
          </p>
          <div className="lp-closing-ctas reveal r4">
            <Link href="/dashboard" className="btn btn-primary">
              Open the dashboard
              <ArrowRight className="arrow h-4 w-4" />
            </Link>
            <a href="#developers" className="btn btn-ghost">View the quickstart</a>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="wrap">
          <div className="lp-footer-grid">
            <div className="lp-footer-brand">
              <Link href="/" className="lp-logo" aria-label="Buzzbox home">
                <span className="lp-logo-mark"><Boxes className="h-4 w-4" /></span>
                <span className="lp-logo-word">Buzz<span>box</span></span>
              </Link>
              <p>Local-first marketing operations control center for human and agent workflows.</p>
              <p className="mono" style={{ fontSize: '0.72rem', letterSpacing: '0.1em', marginTop: 18 }}>
                BUZZBOX · SIGNAL → EXECUTION
              </p>
            </div>
            <div>
              <h3>Product</h3>
              <ul>
                <li><a href="#platform">Platform</a></li>
                <li><a href="#modules">Modules</a></li>
                <li><a href="#developers">Developers</a></li>
                <li><a href="#security">Security</a></li>
              </ul>
            </div>
            <div>
              <h3>Control center</h3>
              <ul>
                <li><Link href="/dashboard">Overview</Link></li>
                <li><Link href="/crm">CRM</Link></li>
                <li><Link href="/outreach">Outreach</Link></li>
                <li><Link href="/content">Content</Link></li>
              </ul>
            </div>
            <div>
              <h3>Project</h3>
              <ul>
                <li><a href="https://github.com/builderz-labs/marketing-dashboard" target="_blank" rel="noreferrer">GitHub</a></li>
                <li><a href="https://github.com/builderz-labs/marketing-dashboard/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">Contributing</a></li>
                <li><a href="https://github.com/builderz-labs/marketing-dashboard/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">Changelog</a></li>
                <li><a href="https://github.com/builderz-labs/marketing-dashboard/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security policy</a></li>
              </ul>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© 2026 Buzzbox — MIT licensed.</span>
            <span className="mono">BUILT FOR OPERATORS WHO READ THE AUDIT LOG</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Module blurbs ─────────────────────────────────────── */

const MODULE_BLURBS: Record<string, string> = {
  '/crm': 'Track leads from first signal to closed stage, with sources, tiers, and quality scoring on every record.',
  '/outreach': 'Multi-step sequences with suppression and engagement tracking — pause, audit, and resume any time.',
  '/content': 'Plan the calendar, draft with agents, queue approvals, and measure performance per item.',
  '/research': 'Daily signal harvest across X, Reddit, and news sources, feeding one shared memory.',
  '/analytics': 'KPI rollups, optional Plausible and GA4 connectors, and cycle-time benchmarks.',
  '/agents/squads': 'Compose agent squads, watch sessions live, and keep workspaces sandboxed.',
  '/automations': 'Cron-native schedules, reusable templates, and a deployment status board.',
  '/approvals': 'One human gate for every write path, with a full audit of who did what.',
  '/integrations': 'Optional connectors with server-side credentials — unused keys stay unset.',
};

function GaugeBadge() {
  return <BarChart3 className="h-5 w-5" />;
}
