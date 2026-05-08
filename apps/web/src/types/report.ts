export type SentimentOverall =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'mixed'
  | 'unknown';

export type IssueType = 'Bug' | 'Feature Request' | 'Question';

export type Severity = 'MINOR' | 'MAJOR' | 'CRITICAL';

export type IssueState = 'open' | 'closed';

export type IssueLifecycle = 'opened' | 'closed' | 'opened-and-closed';

export type ClosureReason = 'fixed' | 'wontfix' | 'duplicate' | 'stale' | 'unknown';

export interface ResolutionCounts {
  fixed: number;
  wontfix: number;
  duplicate: number;
  stale: number;
  unknown: number;
}

export interface IssueCounts {
  total: number;
  discord: number;
  github: number;
}

export interface PrCounts {
  opened: number;
  merged: number;
}

export interface SeverityCounts {
  CRITICAL: number;
  MAJOR: number;
  MINOR: number;
}

export interface TypeCounts {
  Bug: number;
  'Feature Request': number;
  Question: number;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
  Bug: number;
  'Feature Request': number;
  Question: number;
}

export interface IssueStatusCounts {
  open: number;
  closed: number;
}

export interface Comparison {
  backlogDelta: number | null;
  issuesOpenedDelta: number | null;
  issuesClosedDelta: number | null;
  mergedPrDelta: number | null;
  analysisCountDelta: number | null;
  criticalBugDelta: number | null;
  majorBugDelta: number | null;
  sentimentChanged: boolean | null;
  sentimentDeltaSummary: string | null;
}

export interface Takeaways {
  improved: string[];
  regressed: string[];
  watch: string[];
}

export interface ReportActions {
  priorityIssues: number[];
  recommendedActions: string[];
  needsDocsAttention: string[];
  recurringPainAreas: string[];
}

export interface OperationalHealth {
  medianTimeToCloseDays: number | null;
  closedWithin7Days: number;
  closedWithin30Days: number;
}

export type Aspect =
  | 'agents'
  | 'workflows'
  | 'memory'
  | 'rag'
  | 'tools'
  | 'observability'
  | 'deployer'
  | 'studio'
  | 'docs'
  | 'models'
  | 'auth'
  | 'cli'
  | 'voice'
  | 'community'
  | 'other';

export type AspectSentiment = 'positive' | 'negative' | 'mixed';

export interface SentimentSignal {
  headline: string;
  detail: string | null;
  messageIds: string[];
  messageUrls: string[];
}

export interface AspectBreakdown {
  aspect: Aspect;
  sentiment: AspectSentiment;
  positives: SentimentSignal[];
  painPoints: SentimentSignal[];
}

export interface DiscordSentiment {
  overall: SentimentOverall;
  summary: string;
  weekOverWeek: string | null;
  aspects: AspectBreakdown[];
  messageCount: number;
  uniqueAuthorCount: number;
  channelId: string | null;
  channelName: string | null;
}

export type AnalysisSource = 'discord-thread' | 'github-only';

export interface IssueAnalysis {
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueState: IssueState;
  lifecycle: IssueLifecycle;
  closedAt: string | null;
  closureReason: ClosureReason | null;
  authorLogin: string | null;
  createdAt: string;
  commentCount: number;
  labels: string[];
  threadUrl: string | null;
  threadMessageCount: number;
  source: AnalysisSource;
  summary: string;
  type: IssueType;
  category: string;
  severity: Severity;
  correctedAt?: string | null;
}

export interface ReportPeriod {
  start: string;
  end: string;
  label: string;
}

export interface ReportRepo {
  owner: string;
  name: string;
}

export interface ReportSummary {
  openBacklog: number;
  issuesOpened: IssueCounts;
  issuesClosed: IssueCounts;
  pullRequests: PrCounts;
  analysisCount: number;
  typeCounts: TypeCounts;
  bugSeverityCounts: SeverityCounts;
  issueStatusCounts: IssueStatusCounts;
  resolutionCounts: ResolutionCounts;
  closedInWindowCount: number;
  categoryBreakdown: CategoryBreakdown[];
  operationalHealth: OperationalHealth;
  discordSentiment: DiscordSentiment;
}

export type BriefingMovement = 'improved' | 'regressed' | 'steady' | 'mixed';
export type BriefingSeverity = 'critical' | 'major' | 'minor';

export interface BriefingWin {
  text: string;
  evidence: string | null;
}

export interface BriefingRegression {
  text: string;
  evidence: string | null;
  severity: BriefingSeverity;
}

export interface BriefingWatch {
  text: string;
  why: string;
}

export interface BriefingRecurring {
  text: string;
  note: string | null;
}

export interface BriefingCorrection {
  issueNumber: number;
  changed: Array<'severity' | 'type' | 'summary'>;
}

export interface Briefing {
  headline: string;
  movement: BriefingMovement;
  wins: BriefingWin[];
  regressions: BriefingRegression[];
  watchlist: BriefingWatch[];
  recurring: BriefingRecurring[];
  talkingPoints: string[];
  supersedes?: string | null;
  correctionsApplied?: BriefingCorrection[];
}

export interface Report {
  generatedAt: string;
  repo: ReportRepo;
  period: ReportPeriod;
  comparison: Comparison;
  takeaways: Takeaways;
  actions: ReportActions;
  briefing: Briefing | null;
  summary: ReportSummary;
  issueAnalyses: IssueAnalysis[];
}

export interface ReportIndexEntry {
  id: string;
  generatedAt: string;
  repo: ReportRepo;
  period: ReportPeriod;
  comparison: Comparison;
  takeaways: Takeaways;
  briefing: Briefing | null;
  supersedes?: string | null;
  summary: {
    issuesOpened: IssueCounts;
    issuesClosed: IssueCounts;
    pullRequests: PrCounts;
    discordSentiment: SentimentOverall;
    analysisCount: number;
    bugSeverityCounts: SeverityCounts;
  };
}
