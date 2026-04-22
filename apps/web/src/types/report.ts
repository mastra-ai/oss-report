export type SentimentOverall =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'mixed'
  | 'unknown';

export type Urgency = 'low' | 'medium' | 'high';

export interface IssueCounts {
  total: number;
  discord: number;
  rest: number;
}

export interface NpmDownload {
  packageName: string;
  downloads: number;
  start: string;
  end: string;
}

export interface DiscordSentiment {
  overall: SentimentOverall;
  summary: string;
  positiveSignals: string[];
  painPoints: string[];
  messageCount: number;
  channelId: string | null;
  channelName: string | null;
}

export interface IssueAnalysis {
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  labels: string[];
  state: string;
  threadId: string;
  threadUrl: string;
  threadMessageCount: number;
  summary: string;
  status: string;
  urgency: Urgency;
  recommendedAction: string;
  blockers: string[];
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

export interface Report {
  generatedAt: string;
  repo: ReportRepo;
  period: ReportPeriod;
  summary: {
    stars: number;
    issuesOpened: IssueCounts;
    issuesClosed: IssueCounts;
    npmDownloads: {
      total: number;
      packages: NpmDownload[];
    };
    discordSentiment: DiscordSentiment;
  };
  issueAnalyses: IssueAnalysis[];
}

export interface ReportIndexEntry {
  id: string;
  generatedAt: string;
  repo: ReportRepo;
  period: ReportPeriod;
  summary: {
    stars: number;
    issuesOpened: IssueCounts;
    issuesClosed: IssueCounts;
    npmDownloadsTotal: number;
    discordSentiment: SentimentOverall;
    issueAnalysisCount: number;
  };
}
