export type GameKey = 'pd' | 'ultimatum' | 'dictator' | 'coord';

export interface GameDefs {
  order: GameKey[];
  pie: number;
  games: Record<GameKey, {
    title: string;
    scenario: string;
    options?: { value: string; label: string }[];
    payoffs?: Record<string, Record<string, [number, number]>>;
    minAcceptQuestion?: string;
  }>;
}

// What the server sends a student (see studentView in backend/server.js).
export interface StudentView {
  pseudonym: string;
  sessionId: string;
  game: GameKey | null;
  gameNumber: number;
  screen: 'lobby' | 'decide' | 'minAccept' | 'waiting' | 'result';
  role?: 'proposer' | 'responder' | 'dictator';
  deadline?: number;
  myMove?: string;
  partnerMove?: string;
  points?: number;
  offer?: number;
  accepted?: boolean;
  give?: number;
  kept?: number;
  received?: number | null;
  receivedPending?: boolean;
  iTimedOut?: boolean;
  partnerWasComputer?: boolean;
  giverWasComputer?: boolean;
}

export interface Unit {
  id: string;
  members: string[];
  roles: Record<string, string>;
  moves: Record<string, string | number | boolean>;
  minAccept: Record<string, number | null>;
  timedOut: string[];
  bot: boolean;
  payoffs: Record<string, number> | null;
}

export interface GeminiResult {
  model: string;
  status: 'running' | 'done';
  runs?: number;
  answers?: Record<string, (string | number | boolean | null)[]>;
}

export interface Summary {
  sessionId: string;
  joinOpen: boolean;
  phase: 'lobby' | 'open' | 'closed' | 'revealed';
  gameIndex: number;
  game: GameKey | null;
  order: GameKey[];
  present: number;
  joined: number;
  progress: { decided: number; total: number };
  results: Partial<Record<GameKey, { units: Unit[] }>>;
  gemini: Record<string, GeminiResult>;
}
