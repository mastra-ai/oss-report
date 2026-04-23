import { Octokit } from 'octokit';

const repoOwner = process.env.OSS_REPORT_REPO_OWNER || 'mastra-ai';
const repoName = process.env.OSS_REPORT_REPO_NAME || 'mastra';

let githubClient: Octokit | null = null;

export function getReportRepo() {
  return {
    owner: repoOwner,
    repo: repoName,
  };
}

export function getGithubClient() {
  if (githubClient) {
    return githubClient;
  }

  const auth = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  if (!auth) {
    throw new Error('Missing GITHUB_PERSONAL_ACCESS_TOKEN');
  }

  githubClient = new Octokit({ auth });

  return githubClient;
}

export function hasDiscordLabel(labels: Array<string | { name?: string | null }>) {
  return labels.some(label => {
    if (typeof label === 'string') {
      return label.toLowerCase() === 'discord';
    }

    return label.name?.toLowerCase() === 'discord';
  });
}

export interface IssueComment {
  author: string;
  createdAt: string;
  body: string;
}

export async function fetchIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  limit = 30,
  options: { tail?: boolean } = {},
): Promise<IssueComment[]> {
  const github = getGithubClient();
  const response = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
    ...(options.tail ? { sort: 'created', direction: 'desc' } : {}),
  });

  const comments = response.data.slice(0, limit).map(comment => ({
    author: comment.user?.login ?? 'unknown',
    createdAt: comment.created_at,
    body: (comment.body ?? '').slice(0, 2000),
  }));

  // If we fetched tail (desc), restore chronological order for the reader.
  return options.tail ? comments.reverse() : comments;
}

export function buildDiscordThreadUrl(threadId: string): string {
  const guildId = process.env.DISCORD_GUILD_ID;
  return guildId
    ? `https://discord.com/channels/${guildId}/${threadId}`
    : `https://discord.com/channels/@me/${threadId}`;
}

export function extractDiscordThreadId(issueBody: string | null | undefined): string | null {
  if (!issueBody) {
    return null;
  }

  const discordUrlRegex = /https:\/\/discord\.com\/channels\/\d+\/(\d+)/;
  const match = issueBody.match(discordUrlRegex);

  return match?.[1] ?? null;
}
