import { Agent } from '@mastra/core/agent';

export const discordSentimentAgent = new Agent({
  id: 'discord-sentiment-agent',
  name: 'Discord Sentiment Agent',
  instructions: `
    Analyze Discord community messages and produce a concise community sentiment snapshot.
    Focus on overall sentiment, notable themes, pain points, and wins.
    Base conclusions only on the provided messages.
  `,
  model: 'openai/gpt-5-mini',
});
