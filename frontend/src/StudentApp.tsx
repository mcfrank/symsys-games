import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameDefs, GameKey, StudentView } from './types';

// Anonymous id kept on the phone so a refresh rejoins the same pair.
const getUid = () => {
  try {
    let uid = localStorage.getItem('symsys-games-uid');
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem('symsys-games-uid', uid);
    }
    return uid;
  } catch {
    return crypto.randomUUID();
  }
};

const shuffled = <T,>(xs: T[]) => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pts = (n: number) => `${n} point${Math.abs(n) === 1 ? '' : 's'}`;

const Countdown = ({ deadline }: { deadline?: number }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  if (!deadline) return null;
  const s = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <div className={`text-sm tabular-nums ${s <= 10 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{s}s left</div>;
};

const Big = ({ children, onClick, tone = 'primary', disabled }: { children: React.ReactNode; onClick: () => void; tone?: 'primary' | 'secondary'; disabled?: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full rounded-2xl px-5 py-4 text-lg font-semibold shadow-sm active:scale-[0.99] disabled:opacity-40 ${
      tone === 'primary' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 border-2 border-gray-300'}`}
  >
    {children}
  </button>
);

// A 0-10 grid with nothing preselected: a slider's starting position would
// anchor answers, and tapping straight through would record that default.
const AmountPicker = ({ label, valueLabel, onSubmit, submitLabel }: { label: string; valueLabel: (v: number) => string; onSubmit: (v: number) => void; submitLabel: (v: number) => string }) => {
  const [v, setV] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-lg font-medium">{label}</p>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 11 }, (_, i) => (
          <button key={i} onClick={() => setV(i)} aria-pressed={v === i}
            className={`h-14 rounded-xl text-xl font-semibold tabular-nums border-2 ${v === i ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>
            {i}
          </button>
        ))}
      </div>
      <p className="text-gray-500 h-6">{v === null ? 'Tap a number.' : valueLabel(v)}</p>
      <Big onClick={() => v !== null && onSubmit(v)} disabled={v === null}>{v === null ? 'Choose a number' : submitLabel(v)}</Big>
    </div>
  );
};

const PdMatrix = ({ defs }: { defs: GameDefs }) => {
  const p = defs.games.pd.payoffs!;
  const cell = (a: string, b: string) => `${p[a][b][0]} / ${p[a][b][1]}`;
  return (
    <table className="w-full text-center text-sm border border-gray-300 rounded-lg overflow-hidden">
      <thead>
        <tr className="bg-gray-50">
          <th className="p-2 text-left font-normal text-gray-500">You ↓ Partner →</th>
          <th className="p-2">Clean up</th>
          <th className="p-2">Pollute</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        <tr className="border-t border-gray-200"><th className="p-2 text-left">Clean up</th><td>{cell('clean', 'clean')}</td><td>{cell('clean', 'pollute')}</td></tr>
        <tr className="border-t border-gray-200"><th className="p-2 text-left">Pollute</th><td>{cell('pollute', 'clean')}</td><td>{cell('pollute', 'pollute')}</td></tr>
      </tbody>
      <caption className="caption-bottom text-xs text-gray-500 pt-1">Points: yours / your partner's</caption>
    </table>
  );
};

const Waiting = ({ children }: { children: React.ReactNode }) => (
  <div className="text-center space-y-4 py-6">
    <div className="mx-auto h-3 w-3 rounded-full bg-gray-400 animate-ping" />
    <p className="text-lg text-gray-700">{children}</p>
  </div>
);

const ComputerNote = ({ view }: { view: StudentView }) => (
  <>
    {view.iTimedOut && <p className="text-sm text-gray-500">Time ran out, so a computer chose for you.</p>}
    {view.partnerWasComputer && <p className="text-sm text-gray-500">Your partner this round was played by a computer (odd class size or a timeout).</p>}
  </>
);

const PD_LABEL: Record<string, string> = { clean: 'clean up', pollute: 'pollute' };

const GameScreen = ({ view, defs, send }: { view: StudentView; defs: GameDefs; send: (step: string, value: unknown) => void }) => {
  const game = view.game as GameKey;
  const def = defs.games[game];
  const coordOrder = useMemo(() => shuffled(defs.games.coord.options || []), [defs, view.sessionId]);

  if (game === 'pd') {
    if (view.screen === 'decide') return (
      <div className="space-y-5">
        <PdMatrix defs={defs} />
        <div className="grid grid-cols-2 gap-3">
          {/* Same style for both, so neither choice looks like the default. */}
          <Big onClick={() => send('move', 'clean')} tone="secondary">Clean up</Big>
          <Big onClick={() => send('move', 'pollute')} tone="secondary">Pollute</Big>
        </div>
      </div>
    );
    if (view.screen === 'waiting') return <Waiting>You chose to {PD_LABEL[view.myMove!]}. Waiting for your partner…</Waiting>;
    return (
      <div className="space-y-3">
        <p className="text-xl">You chose to <b>{PD_LABEL[view.myMove!]}</b>. Your partner chose to <b>{PD_LABEL[view.partnerMove!]}</b>.</p>
        <p className="text-3xl font-bold">You got {pts(view.points!)}.</p>
        <ComputerNote view={view} />
      </div>
    );
  }

  if (game === 'coord') {
    if (view.screen === 'decide') return (
      <div className="space-y-3">
        {coordOrder.map((o) => <Big key={o.value} tone="secondary" onClick={() => send('move', o.value)}>{o.label}</Big>)}
      </div>
    );
    if (view.screen === 'waiting') return <Waiting>You picked {view.myMove}. Waiting for your partner…</Waiting>;
    const matched = view.myMove === view.partnerMove;
    return (
      <div className="space-y-3">
        <p className="text-xl">You picked <b>{view.myMove}</b>. Your partner picked <b>{view.partnerMove}</b>.</p>
        <p className="text-3xl font-bold">{matched ? 'You matched!' : 'No match.'} You got {pts(view.points!)}.</p>
        <ComputerNote view={view} />
      </div>
    );
  }

  if (game === 'ultimatum') {
    const isProposer = view.role === 'proposer';
    const roleLine = <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">You are the {isProposer ? 'proposer' : 'responder'}</p>;
    if (view.screen === 'minAccept') return (
      <div className="space-y-4">{roleLine}
        <AmountPicker label={def.minAcceptQuestion!} valueLabel={(v) => `I'd accept an offer of ${v} or more`} submitLabel={(v) => `Save: ${v}`} onSubmit={(v) => send('minAccept', v)} />
      </div>
    );
    if (view.screen === 'decide' && isProposer) return (
      <div className="space-y-4">{roleLine}
        <AmountPicker label="How many points do you offer your partner?" valueLabel={(v) => `You keep ${10 - v}`} submitLabel={(v) => `Offer ${v}, keep ${10 - v}`} onSubmit={(v) => send('offer', v)} />
      </div>
    );
    if (view.screen === 'decide') return (
      <div className="space-y-5">{roleLine}
        <p className="text-xl">Your partner offers you <b>{pts(view.offer!)}</b> and would keep {10 - view.offer!}.</p>
        <div className="grid grid-cols-2 gap-3">
          <Big onClick={() => send('response', true)} tone="secondary">Accept</Big>
          <Big onClick={() => send('response', false)} tone="secondary">Reject</Big>
        </div>
      </div>
    );
    if (view.screen === 'waiting') return (
      <div className="space-y-2">{roleLine}
        <Waiting>{isProposer ? `You offered ${view.offer}. Waiting for your partner to respond…` : "Waiting for your partner's offer…"}</Waiting>
      </div>
    );
    return (
      <div className="space-y-3">{roleLine}
        <p className="text-xl">
          {isProposer ? <>You offered <b>{view.offer}</b>. Your partner <b>{view.accepted ? 'accepted' : 'rejected'}</b> it.</>
            : <>Your partner offered <b>{view.offer}</b>. You <b>{view.accepted ? 'accepted' : 'rejected'}</b> it.</>}
        </p>
        <p className="text-3xl font-bold">You got {pts(view.points!)}.</p>
        <ComputerNote view={view} />
      </div>
    );
  }

  // dictator
  if (view.screen === 'decide') return (
    <AmountPicker label="How many points do you give your classmate?" valueLabel={(v) => `You keep ${10 - v}`} submitLabel={(v) => `Give ${v}, keep ${10 - v}`} onSubmit={(v) => send('give', v)} />
  );
  return (
    <div className="space-y-3">
      <p className="text-xl">You gave <b>{view.give}</b> and kept <b>{view.kept}</b>.</p>
      {view.iTimedOut && <p className="text-sm text-gray-500">Time ran out, so a computer chose for you.</p>}
      {view.receivedPending
        ? <Waiting>Waiting to hear what another classmate gave you…</Waiting>
        : view.received != null && (
          <>
            <p className="text-xl">Another classmate gave you <b>{view.received}</b>.</p>
            <p className="text-3xl font-bold">Total: {pts(view.kept! + view.received)}.</p>
            {view.giverWasComputer && <p className="text-sm text-gray-500">That gift was chosen by a computer (a classmate timed out).</p>}
          </>
        )}
    </div>
  );
};

export const StudentApp = () => {
  const [defs, setDefs] = useState<GameDefs | null>(null);
  const [view, setView] = useState<StudentView | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [joinClosed, setJoinClosed] = useState(false);

  useEffect(() => {
    fetch('/api/games').then((r) => r.json()).then(setDefs).catch(() => {});
    const uid = getUid();
    const s = io({ transports: ['websocket', 'polling'] });
    s.on('connect', () => { setConnected(true); s.emit('hello', { uid }); });
    s.on('disconnect', () => setConnected(false));
    s.on('view', (v: StudentView) => { setJoinClosed(false); setView(v); });
    s.on('join_closed', () => setJoinClosed(true));
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  const send = (step: string, value: unknown) => socket?.emit('submit', { game: view?.game, step, value });
  const def = view?.game && defs ? defs.games[view.game] : null;

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto px-4 py-5">
      <header className="flex items-center justify-between mb-5">
        <div className="text-sm text-gray-500">SYMSYS 1 · Let's play a game</div>
        {view && <div className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium">{view.pseudonym}</div>}
      </header>

      <main className="flex-1">
        {joinClosed ? (
          <p className="text-lg">Joining is closed for this session.</p>
        ) : !view || !defs ? (
          <Waiting>Connecting…</Waiting>
        ) : view.screen === 'lobby' ? (
          <div className="space-y-3 pt-6">
            <p className="text-2xl font-semibold">You're in, {view.pseudonym}!</p>
            <p className="text-lg text-gray-700">Waiting for the next game to start. Keep this page open.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="text-2xl font-bold">{def!.title}</h1>
              {(view.screen === 'decide' || view.screen === 'minAccept') && <Countdown deadline={view.deadline} />}
            </div>
            {(view.screen === 'decide' || view.screen === 'minAccept') && <p className="text-gray-700">{def!.scenario}</p>}
            <GameScreen view={view} defs={defs} send={send} />
          </div>
        )}
        {view && !connected && <p className="mt-6 text-sm text-amber-700">Reconnecting…</p>}
      </main>

      <footer className="mt-8 text-xs text-gray-400 text-center">
        Anonymous: no names or logins. Built with Claude Opus 5.5.
      </footer>
    </div>
  );
};
