export type Team = 'A' | 'B';
export type EndingRule = 'standard' | 'golden_point';
export type QueueMode = 'fair_rotation' | 'winner_priority';
export type AttendanceStatus = 'not_arrived' | 'checked_in' | 'on_break' | 'checked_out';
export interface SessionAttendance {
  sessionId: string;
  playerId: string;
  status: AttendanceStatus;
  checkedInAt: number | null;
  queueEnteredAt: number | null;
  lastPlayedAt: number | null;
  eligibleWaitMs: number;
  clockStartedAt: number | null;
  availableSince: number | null;
  eligibilityEpoch: number;
  eligibleGamesMissed: number;
  consecutiveSitOuts: number;
  consecutiveGames: number;
  gamesPlayedSinceCheckIn: number;
  eligibleOpportunities: number;
  history: {status: AttendanceStatus; at: number}[];
}
export interface FixedPair {
  id: string;
  sessionId: string;
  playerIds: [string, string];
  createdAt: number;
  active: boolean;
}
export interface RotationRecord {
  gameId: string;
  groupKey: string;
  teamA: string[];
  teamB: string[];
}
export interface SessionStat {
  playerId: string;
  playerName: string;
  gamesPlayedInSession: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  currentWinStreak: number;
  currentLossStreak: number;
  partners: any[];
  opponents: any[];
}
export interface Ranking {
  playerId: string;
  playerName: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  winPercentage: number;
  rank?: number;
}
export interface Player {
  id: string;
  name: string;
  isActive: boolean;
  isAvailable?: boolean;
  gamesPlayed: number;
  lastPlayedGameNumber: number | null;
  waitingSinceGameNumber: number;
  partnerHistory: string[];
  opponentHistory: string[];
  [key: string]: any;
}
export type CourtPositions = Record<Team, { right: string; left: string }>;
export interface ScoringConfig {
  firstServingTeam: Team;
  startingRight: Record<Team, string>;
  target?: number;
  mode?: 'traditional';
  endingRule?: EndingRule;
}
export interface ScoringState {
  version: number;
  matchId: string;
  teams: Record<Team, string[]>;
  initialConfig: ScoringConfig;
  mode: 'traditional';
  target: number;
  endingRule: EndingRule;
  scores: Record<Team, number>;
  positions: CourtPositions;
  servingTeam: Team;
  serverId: string;
  serverNumber: number;
  status: 'in_progress' | 'game_over';
  winner: Team | null;
  history: {type: 'rally' | 'correction'; winner?: Team; before: Omit<ScoringState, 'history'>}[];
  revision: number;
  manuallyCorrected: boolean;
  hasRecordedRally: boolean;
}
export interface Game {
  gameId: string;
  gameNumber: number;
  status: string;
  teamA: Pick<Player, 'id' | 'name'>[];
  teamB: Pick<Player, 'id' | 'name'>[];
  teamAScore: number | null;
  teamBScore: number | null;
  scoringState?: ScoringState;
  endingRule?: EndingRule;
  targetScore?: number;
  lineupLocked?: boolean;
  rotationEligibility?: Record<string, number>;
  [key: string]: any;
}
export interface Session {
  sessionId: string;
  sessionNumber: number;
  sessionName: string;
  dateStarted: string;
  dateEnded: string | null;
  status: string;
  queueMode: QueueMode;
  currentGame?: Game | null;
  pendingGame?: Game | null;
  games: Game[];
  playerStats: Record<string, SessionStat>;
  finalLeaderboard?: Ranking[];
  cancelledGames?: Game[];
  endingRule?: EndingRule;
  targetScore?: number;
  participationVersion?: 1;
  attendance?: Record<string, SessionAttendance>;
  attendanceNeedsReview?: boolean;
  fixedPairs?: FixedPair[];
  rotationHistory?: RotationRecord[];
  pendingInvalidReason?: string | null;
  [key: string]: any;
}
export interface AppData {
  schemaVersion?: number;
  players: Player[];
  settings: {currentGameNumber: number; currentSessionNumber: number};
  activeSession: Session | null;
  pastSessions: Session[];
  [key: string]: any;
}
