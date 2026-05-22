import { ChannelType, Client, GatewayIntentBits, Message, SnowflakeUtil, ThreadChannel, type Collection } from 'discord.js';

let discordClientPromise: Promise<Client> | null = null;

async function ensureReady(client: Client) {
  if (client.isReady()) {
    return client;
  }

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      client.off('clientReady', onReady);
      client.off('error', onError);
    };

    client.once('clientReady', onReady);
    client.once('error', onError);
  });

  return client;
}

export async function getDiscordClient() {
  if (!discordClientPromise) {
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
      throw new Error('Missing DISCORD_BOT_TOKEN');
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    discordClientPromise = client.login(token).then(() => ensureReady(client));
  }

  return discordClientPromise;
}

export type DiscordChannelReply = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorBot: boolean;
  createdAt: string;
  content: string;
  url: string;
};

export type DiscordChannelMessage = DiscordChannelReply & {
  threadId: string | null;
  threadName: string | null;
  threadUrl: string | null;
  replies: DiscordChannelReply[];
};

function toReplyDto(message: Message): DiscordChannelReply {
  return {
    id: message.id,
    authorId: message.author.id,
    authorUsername: message.author.username,
    authorBot: message.author.bot,
    createdAt: message.createdAt.toISOString(),
    content: message.content,
    url: message.url,
  };
}

export async function fetchMessagesInWindow(
  channelId: string,
  since: Date,
  until: Date,
  limit = 250,
): Promise<DiscordChannelMessage[]> {
  const client = await getDiscordClient();
  const channel = await client.channels.fetch(channelId);

  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not messageable`);
  }

  const collected: Message[] = [];
  let before: string | undefined = SnowflakeUtil.generate({ timestamp: until }).toString();

  outer: while (collected.length < limit) {
    const batch: Collection<string, Message> = await channel.messages.fetch({
      limit: Math.min(100, limit - collected.length),
      before,
    });

    if (batch.size === 0) {
      break;
    }

    const messages = [...batch.values()];

    for (const message of messages) {
      if (message.createdAt < since) {
        break outer;
      }

      if (message.createdAt < until && !message.author.bot && message.content.trim()) {
        collected.push(message);
      }
    }

    before = messages[messages.length - 1]?.id;
  }

  const deduped = dedupeReplyEchoes(collected);
  return Promise.all(deduped.map(message => hydrateWithThread(message)));
}

async function hydrateWithThread(message: Message): Promise<DiscordChannelMessage> {
  const base: DiscordChannelMessage = {
    ...toReplyDto(message),
    threadId: null,
    threadName: null,
    threadUrl: null,
    replies: [],
  };

  if (!message.hasThread) {
    return base;
  }

  try {
    let thread: ThreadChannel | undefined = message.thread ?? undefined;
    if (!thread) {
      const parent = message.channel;
      if ('threads' in parent) {
        const fetched = await parent.threads.fetch(message.id).catch(() => undefined);
        if (fetched && 'isThread' in fetched && fetched.isThread()) {
          thread = fetched as ThreadChannel;
        }
      }
    }
    if (!thread) return base;

    if (thread.archived && !thread.joined) {
      await thread.join().catch(() => undefined);
    }

    const fetched = await thread.messages.fetch({ limit: 100 });
    const replies = [...fetched.values()]
      .filter(reply => reply.id !== message.id)
      .filter(reply => !reply.author.bot && reply.content.trim())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(toReplyDto);

    return {
      ...base,
      threadId: thread.id,
      threadName: thread.name,
      threadUrl: `https://discord.com/channels/${thread.guildId}/${thread.id}`,
      replies,
    };
  } catch {
    return base;
  }
}

// Discord relays reply previews as short truncated copies of the referenced
// message, often attributed to the replier rather than the original author.
// These echoes inflate citation counts and noise. Drop a message when its
// content is a short prefix of another message in the window.
const ECHO_MAX_LENGTH = 50;
function dedupeReplyEchoes(messages: Message[]): Message[] {
  return messages.filter(candidate => {
    const content = candidate.content.trim();
    if (content.length > ECHO_MAX_LENGTH) return true;
    return !messages.some(other => {
      if (other.id === candidate.id) return false;
      const otherContent = other.content.trim();
      if (otherContent.length <= content.length) return false;
      return otherContent.startsWith(content);
    });
  });
}

export async function fetchThreadMessages(threadId: string, limit = 100) {
  const client = await getDiscordClient();
  const channel = await client.channels.fetch(threadId);

  if (!channel) {
    throw new Error(`Thread ${threadId} not found`);
  }

  if (!channel.isThread()) {
    throw new Error(`Channel ${threadId} is not a thread`);
  }

  const thread = channel as ThreadChannel;

  if (thread.archived && !thread.joined) {
    await thread.join().catch(() => undefined);
  }

  const messages = await thread.messages.fetch({ limit: Math.min(limit, 100) });

  return {
    threadName: thread.name,
    threadUrl: `https://discord.com/channels/${thread.guildId}/${thread.id}`,
    messages: [...messages.values()]
      .filter(message => !message.author.bot && message.content.trim())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(message => ({
        id: message.id,
        author: message.author.username,
        createdAt: message.createdAt.toISOString(),
        content: message.content,
        url: message.url,
      })),
  };
}

export async function getChannelName(channelId: string) {
  const client = await getDiscordClient();
  const channel = await client.channels.fetch(channelId);

  return channel?.isThread() || channel?.type === ChannelType.GuildText ? channel.name : channelId;
}
