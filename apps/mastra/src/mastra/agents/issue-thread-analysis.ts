import { Agent } from '@mastra/core/agent';

export const issueThreadAnalysisAgent = new Agent({
  id: 'issue-thread-analysis-agent',
  name: 'Issue Thread Analysis Agent',
  instructions: `
    Analyze a GitHub issue together with its linked Discord thread.
    Summarize the user problem, the current status, blockers, urgency, and next recommended action.
    Be concrete and avoid speculation beyond the supplied issue and thread content.
  `,
  model: 'openai/gpt-5-mini',
});
