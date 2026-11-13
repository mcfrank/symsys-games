import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import type { GameDefs, GameKey, Summary } from './types';
import { coordStats, dictatorStats, geminiStats, mean, pdStats, ultimatumStats } from './stats';
import { AcceptanceChart, AmountHistogram, COLORS, num, OptionBars, pct, ShapeKey } from './charts';

declare global { interface Window { google?: any } }

const TOKEN_KEY = 'symsys-games-admin-token';
const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v: string) => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

const Hero = ({ value, label }: { value: string; label: string }) => (
  <div>
    <div className="text-6xl font-semibold tabular-nums">{value}</div>
    <div className="text-lg text-gray-600 mt-1">{label}</div>
  </div>
);

const Legend = ({ items }: { items: { label: string; color?: string; line?: boolean; shape?: number }[] }) => (
  <div className="flex flex-wrap gap-x-6 gap-y-1 text-base text-gray-700">
    {items.map((it) => (
      <span key={it.label} className="flex items-center gap-2">
        {it.shape !== undefined ? <ShapeKey i={it.shape} />
          : it.line ? <span className="inline-block w-5 h-[3px]" style={{ background: it.color }} />
            : <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ background: it.color }} />}
        {it.label}
      </span>
    ))}
  </div>
);

const Cite = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-gray-500">{children}</p>;

type GeminiList = ReturnType<typeof geminiStats>[];

const PdResults = ({ summary, gemini }: { summary: Summary; gemini: GeminiList }) => {
  const s = pdStats(summary.results.pd!.units);
  const cell = (a: 'clean' | 'pollute', b: 'clean' | 'pollute', nash = false) => (
    <td className={`p-4 text-center text-3xl tabular-nums ${nash ? 'bg-[#f0efec]' : ''}`}>
      {s.grid[a][b]}
      {nash && <div className="text-sm font-semibold text-gray-700">Nash equilibrium</div>}
    </td>
  );
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
      <div className="space-y-8">
        <Hero value={pct(s.pctClean)} label={`cleaned up (n = ${s.n})`} />
        <div>
          <div className="text-4xl font-semibold tabular-nums">{num(s.avgPoints)}</div>
          <div className="text-lg text-gray-600">average points per student, vs. −2 if everyone cleaned up and −8 if everyone polluted</div>
        </div>
        {gemini.map((m, i) => <div key={m.label} className="text-lg flex items-center gap-2"><ShapeKey i={i} /> {m.label}: {pct(m.pctClean)} cleaned up (n = {m.nPd} runs)</div>)}
      </div>
      <div>
        <table className="w-full border border-gray-300 text-lg">
          <thead><tr className="bg-gray-50"><th className="p-3 text-left font-normal text-gray-600">Students: you ↓ partner →</th><th className="p-3">Clean up</th><th className="p-3">Pollute</th></tr></thead>
          <tbody>
            <tr className="border-t border-gray-200"><th className="p-3 text-left">Clean up</th>{cell('clean', 'clean')}{cell('clean', 'pollute')}</tr>
            <tr className="border-t border-gray-200"><th className="p-3 text-left">Pollute</th>{cell('pollute', 'clean')}{cell('pollute', 'pollute', true)}</tr>
          </tbody>
        </table>
        <Cite>Counts of students in each outcome, from the {s.nPairs} pairs of two students where nobody timed out.</Cite>
      </div>
    </div>
  );
};

const UltimatumResults = ({ summary, gemini }: { summary: Summary; gemini: GeminiList }) => {
  const s = ultimatumStats(summary.results.ultimatum!.units);
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h3 className="text-2xl font-semibold">Offers</h3>
        <p className="text-lg text-gray-700">Mean {num(s.mean)} · median {num(s.median)} · n = {s.offers.length}</p>
        <AmountHistogram
          series={[{ label: 'Student offers', color: COLORS.s1, counts: s.counts }]}
          refs={[{ x: 1, label: 'Nash: 1' }]}
          band={{ from: 4, to: 5, label: 'Camerer (2003): most offers' }}
          gemini={gemini.map((m, i) => ({ label: m.label, x: mean(m.offers), index: i }))}
          xLabel="Points offered to the responder (out of 10)"
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-2xl font-semibold">Who accepts what?</h3>
        <Legend items={[
          { label: 'Accepted (real decisions; faint = fewer than 3)', color: COLORS.s1 },
          { label: `Said they'd accept this offer (n = ${s.minAccept.length})`, color: COLORS.s2, line: true },
          ...gemini.map((m, i) => ({ label: m.label, shape: i })),
        ]} />
        <AcceptanceChart acceptance={s.acceptance} curve={s.minAcceptCurve} gemini={gemini.map((m, i) => ({ label: m.label, index: i, rates: m.acceptance }))} />
        <Cite>Nash: accept any positive offer. Camerer (2003): offers under 20% are rejected about half the time.</Cite>
      </div>
    </div>
  );
};

const DictatorResults = ({ summary, gemini }: { summary: Summary; gemini: GeminiList }) => {
  const s = dictatorStats(summary.results.dictator!.units, summary.results.ultimatum?.units || []);
  return (
    <div className="space-y-4">
      <p className="text-lg text-gray-700">
        Dictator gifts: mean {num(s.meanGift)} (n = {s.gifts.length}). Ultimatum offers: mean {num(s.meanOffer)} (n = {s.offers.length}).
        {s.within.n > 0 && <> The {s.within.n} students who did both offered {num(s.within.meanOffer)} as proposers and gave {num(s.within.meanGift)} as dictators.</>}
      </p>
      <Legend items={[{ label: 'Dictator gifts', color: COLORS.s1 }, { label: 'Ultimatum offers', color: COLORS.s2 }]} />
      <AmountHistogram
        series={[{ label: 'Dictator gifts', color: COLORS.s1, counts: s.giftCounts }, { label: 'Ultimatum offers', color: COLORS.s2, counts: s.offerCounts }]}
        refs={[{ x: 0, label: 'Nash: 0' }, { x: 2.8, label: 'Engel (2011): mean 28%' }]}
        gemini={gemini.map((m, i) => ({ label: `${m.label} gift`, x: mean(m.gifts), index: i }))}
        xLabel="Points given (out of 10)"
      />
      <Cite>The gap between what people offer when they can be rejected and what they give when they can't separates fairness from fear of rejection.</Cite>
    </div>
  );
};

const CoordResults = ({ summary, gemini, options }: { summary: Summary; gemini: GeminiList; options: string[] }) => {
  const s = coordStats(summary.results.coord!.units, options);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-10">
      <div className="space-y-6">
        <Hero value={pct(s.pctMatched)} label={`of pairs met (${s.nPairs} pairs)`} />
        <div className="text-lg text-gray-600">vs. {pct(s.chance)} if everyone picked at random</div>
        <Cite>No unique Nash equilibrium: any matching pair is one. People find focal points (Schelling, 1960). Options were shown in a random order on each phone.</Cite>
      </div>
      <div className="space-y-2">
        <OptionBars options={options} counts={s.counts} gemini={gemini.map((m, i) => ({ label: m.label, index: i, counts: m.coordCounts }))} />
      </div>
    </div>
  );
};

export const Dashboard = () => {
  const [clientId, setClientId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(store.get());
  const [denied, setDenied] = useState(false);
  const [defs, setDefs] = useState<GameDefs | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [qr, setQr] = useState('');
  const [view, setView] = useState<GameKey | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const joinUrl = window.location.origin;

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((d) => setClientId(d.oauthClientId || '')).catch(() => setClientId(''));
    fetch('/api/games').then((r) => r.json()).then(setDefs).catch(() => {});
    QRCode.toDataURL(joinUrl, { margin: 1, width: 600 }).then(setQr).catch(() => {});
  }, [joinUrl]);

  useEffect(() => {
    if (token || !clientId) return;
    const init = () => {
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => { store.set(r.credential); setDenied(false); setToken(r.credential); } });
      const el = document.getElementById('gsi-button');
      if (el) window.google.accounts.id.renderButton(el, { size: 'large' });
    };
    if (window.google?.accounts?.id) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [token, clientId]);

  useEffect(() => {
    if (!token) return;
    const s = io({ transports: ['websocket', 'polling'] });
    s.on('connect', () => s.emit('admin_hello', { token }));
    s.on('admin_denied', () => { store.clear(); setDenied(true); setToken(null); });
    s.on('summary', setSummary);
    socketRef.current = s;
    return () => { s.disconnect(); };
  }, [token]);

  // Follow the current game once it's revealed.
  useEffect(() => {
    if (summary?.phase === 'revealed' && summary.game) setView(summary.game);
  }, [summary?.phase, summary?.game]);

  const gemini = useMemo(() => Object.values(summary?.gemini || {})
    .filter((r) => r.status === 'done')
    .map((r) => geminiStats(r, defs?.games.coord.options?.map((o) => o.value) || [])), [summary?.gemini, defs]);

  const cmd = (c: string) => socketRef.current?.emit('admin_cmd', { cmd: c });
  const downloadCsv = async () => {
    const res = await fetch('/api/admin/export.csv', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { alert('Download failed; try signing in again.'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `symsys-games-${summary?.sessionId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-3xl font-semibold">SymSys games: instructor dashboard</h1>
        {clientId === '' && <p className="text-red-700">Sign-in isn't configured (GOOGLE_OAUTH_CLIENT_ID).</p>}
        {denied && <p className="text-red-700">That account isn't on the instructor list, or the sign-in expired.</p>}
        <div id="gsi-button" />
      </div>
    );
  }
  if (!summary || !defs) return <div className="p-8 text-xl">Connecting…</div>;

  const title = (k: GameKey | null) => (k ? defs.games[k].title : 'Lobby');
  const next = summary.order[summary.gameIndex + 1] as GameKey | undefined;
  const canStart = (summary.phase === 'lobby' || summary.phase === 'revealed') && next;
  const revealedKeys = summary.order.filter((k) => summary.results[k]);
  const shown = view && summary.results[view] ? view : null;
  const options = defs.games.coord.options?.map((o) => o.value) || [];
  const btn = 'rounded-xl px-5 py-3 text-lg font-semibold disabled:opacity-30';
  const geminiStatus = Object.values(summary.gemini).map((r) => `${r.model.replace('gemini-', '')} ${r.status === 'done' ? '✓' : '…'}`).join(', ');

  return (
    <div className="min-h-screen p-6 lg:p-10 max-w-[1600px] mx-auto">
      <header className="flex flex-wrap items-center gap-6 mb-8">
        <div className="flex-1 min-w-[300px]">
          <div className="text-gray-500 text-lg">
            {summary.gameIndex >= 0 ? `Game ${summary.gameIndex + 1} of ${summary.order.length}` : 'Lobby'} · {summary.present} here
          </div>
          {/* After a reveal, the headline names the results on screen. */}
          <h1 className="text-4xl font-semibold">{title(summary.phase === 'revealed' && shown ? shown : summary.game)}</h1>
        </div>
        {summary.phase === 'open' && (
          <div className="text-3xl tabular-nums font-semibold">{summary.progress.decided} / {summary.progress.total} decided</div>
        )}
        <div className="flex gap-3">
          {canStart && <button className={`${btn} bg-gray-900 text-white`} onClick={() => cmd('start')}>Start: {title(next!)}</button>}
          {summary.phase === 'open' && <button className={`${btn} border-2 border-gray-300`} onClick={() => cmd('close')}>Close</button>}
          {(summary.phase === 'open' || summary.phase === 'closed') && <button className={`${btn} bg-gray-900 text-white`} onClick={() => cmd('reveal')}>Reveal</button>}
        </div>
        {summary.joinOpen && summary.phase !== 'lobby' && qr && <img src={qr} alt="Join QR code" className="w-28 h-28" />}
      </header>

      {summary.phase === 'lobby' ? (
        <div className="flex flex-col lg:flex-row items-center gap-12 py-6">
          {summary.joinOpen && qr && <img src={qr} alt="Join QR code" className="w-[420px] h-[420px]" />}
          <div className="space-y-4">
            <div className="text-2xl text-gray-600">Scan to join, or go to</div>
            <div className="text-4xl font-semibold break-all">{joinUrl.replace(/^https?:\/\//, '')}</div>
            <div className="text-7xl font-semibold tabular-nums pt-4">{summary.present}</div>
            <div className="text-2xl text-gray-600">students joined</div>
          </div>
        </div>
      ) : summary.phase === 'open' || summary.phase === 'closed' ? (
        <div className="py-16 text-center space-y-4">
          <div className="text-8xl font-semibold tabular-nums">{summary.progress.decided} / {summary.progress.total}</div>
          <div className="text-2xl text-gray-600">{summary.phase === 'open' ? 'decided so far. Results stay hidden until Reveal.' : 'Closed. Click Reveal to show results.'}</div>
        </div>
      ) : null}

      {revealedKeys.length > 0 && summary.phase !== 'open' && summary.phase !== 'closed' && (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {revealedKeys.map((k) => (
              <button key={k} onClick={() => setView(k)}
                className={`rounded-full px-4 py-1.5 text-base border ${shown === k ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`}>
                {title(k)}
              </button>
            ))}
          </div>
          {shown && (
            <div>
              {gemini.length > 0 && <div className="mb-4"><Legend items={gemini.map((m, i) => ({ label: `${m.label} (10 runs)`, shape: i }))} /></div>}
              {shown === 'pd' && <PdResults summary={summary} gemini={gemini} />}
              {shown === 'ultimatum' && <UltimatumResults summary={summary} gemini={gemini} />}
              {shown === 'dictator' && <DictatorResults summary={summary} gemini={gemini} />}
              {shown === 'coord' && <CoordResults summary={summary} gemini={gemini} options={options} />}
            </div>
          )}
        </section>
      )}

      <footer className="mt-16 pt-6 border-t border-gray-200 flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <button className="underline" onClick={() => cmd('toggleJoin')}>{summary.joinOpen ? 'Close joining' : 'Reopen joining'}</button>
        <button className="underline" onClick={downloadCsv}>Download CSV</button>
        <button className="underline" onClick={() => cmd('runGemini')}>Re-run Gemini</button>
        <span>Gemini: {geminiStatus || 'not run'}</span>
        <button className="underline" onClick={() => { if (confirm('Start a new session? Everyone stays connected but gets a new pseudonym, and the current results are archived.')) cmd('newSession'); }}>New session</button>
        <span className="flex-1" />
        <span>{summary.joined} joined · session {summary.sessionId.slice(0, 8)} · Built with Claude Opus 5.5</span>
      </footer>
    </div>
  );
};
