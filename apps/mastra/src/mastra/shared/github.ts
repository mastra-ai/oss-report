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

export function extractDiscordThreadId(issueBody: string | null | undefined): string | null {
  if (!issueBody) {
    return null;
  }

  const discordUrlRegex = /https:\/\/discord\.com\/channels\/\d+\/(\d+)/;
  const match = issueBody.match(discordUrlRegex);

  return match?.[1] ?? null;
}
