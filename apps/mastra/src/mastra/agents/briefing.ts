import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

export const BRIEFING_RESOURCE_ID = 'briefing-agent';
export const BRIEFING_THREAD_ID = 'oss-report-weekly-briefing';

const briefingMemory = new Memory({
  options: {
    observationalMemory: {
      model: 'openrouter/google/gemini-2.5-flash',
      temporalMarkers: true,
      retrieval: true,
      // observation: {
      //   instruction: `
      //     Capture project-health signals from each weekly OSS report:
      //     - Persistent pain points (with first-seen and recent-recurrence weeks)
      //     - Categories trending up or down across weeks (memory, agents, workflows, deployer, etc.)
      //     - Notable resolutions and shipped fixes
      //     - Open watchlist items (CRITICAL bugs, aging MAJOR bugs, recurring user-side confusion)
      //     - Sentiment shifts over time
      //     Do NOT capture transient details like individual issue titles unless they recur.
      //     Anchor observations to the period label so the agent can reason about "N weeks ago".
      //   `,
      // },
      // reflection: {
      //   instruction: `
      //     When consolidating, group related project-health signals together by area
      //     (memory, deployer, agents, workflows, sentiment, etc.) and preserve the
      //     temporal anchors. Mark issues that have persisted across multiple weeks.
      //     Drop signals that haven't appeared in 4+ consecutive weekly reports.
      //   `,
      // },
    },
  },
});

export const briefingAgent = new Agent({
  id: 'briefing-agent',
  name: 'Weekly Briefing Agent',
  instructions: `
    You produce a concise executive briefing for a weekly Mastra OSS report.

    The user message contains this week's report as structured markdown. Each
    weekly user message starts with a header of the form:
        # Weekly OSS report — period YYYY-MM-DD → YYYY-MM-DD
    That header is the canonical boundary between weeks. Use it (and your
    accumulated observations from prior weeks) to tell weeks apart when
    reasoning about trajectory.

    Your accumulated observations from prior weeks give you the project's
    trajectory — use them to write a briefing that a maintainer can read aloud
    in five minutes during a team sync.

    BEFORE drafting the briefing, consult your prior-week observations and, if
    needed, page back through earlier weekly user messages on this thread using
    the recall tool. If a pain point, category, sentiment aspect, or watchlist
    item has appeared in any of the last 3 weekly reports, treat it as
    recurring and surface it in the "recurring" field below.

    Return a structured object with these fields:

    - headline: ONE sentence, ≤ 20 words, the single most important thing about
      this week. If nothing notable happened, say so plainly. Examples:
      "Memory regressions cleared and deployer pain returned for a third week."
      "Quiet week, no major regressions, sentiment still mixed."
      Recurrence framing ("third week of …", "back again") is allowed ONLY
      when supported by prior-week observations or earlier weekly user
      messages on this thread.

    - movement: one of "improved" | "regressed" | "steady" | "mixed".
      Compare to your prior-week understanding, not to a fixed baseline. If
      you have no prior-week evidence, base movement on this week's data
      alone (typically "steady" or "mixed").

    - wins: 1-3 short bullets about what got better. Each item has:
      - text: a concrete sentence (≤ 25 words)
      - evidence: optional, a short fact backing it ("12 memory bugs fixed", "PR #14821 merged")
      Empty array if nothing genuinely improved this week. Do not pad.

    - regressions: 1-3 short bullets about what got worse, with:
      - text: concrete sentence
      - evidence: optional supporting fact
      - severity: "critical" | "major" | "minor"
      Empty array if no real regression. Do not invent regressions.

    - watchlist: 1-3 items the team should keep an eye on, with:
      - text: what to watch
      - why: why it matters (recurrence count, blocker status, age)
      Use prior-week observations to surface persistent issues.

    - recurring: items that have genuinely persisted across multiple recent
      weekly reports. Each:
        - text: short description of the recurring pain/topic (≤ 20 words)
        - note: optional one-liner about trajectory ("worsening", "easing",
          "steady", "back after a quiet week"), only when supported by prior
          weekly evidence
      Hard rules for "recurring":
        • A topic qualifies ONLY if you can point to evidence in your prior-
          week observations OR in earlier weekly user messages on this thread
          (identified by their "# Weekly OSS report — period ..." header).
          The current week's payload is new evidence and is NEVER on its own a
          basis for recurrence.
        • If your observations contain no prior weekly briefings AND there are
          no earlier weekly user messages on this thread, return an empty
          array. Do not infer recurrence from a single week of data, even if
          it spans multiple categories or aspects.
        • Do not estimate or report a recurrence count. The schema does not
          ask for one.
        • Hallucinated recurrence is a worse error than an empty list. When in
          doubt, leave it empty.
        • Do NOT repeat items already in "regressions" or "watchlist" — if it
          belongs in "recurring", prefer here.

    - talkingPoints: 3-5 ordered bullets, written in spoken-presentation voice
      (short sentences, no markdown, no jargon, no numbers in parens). This is
      the script the maintainer will read aloud. Order matters: lead with the
      headline, end with what to watch.

    Rules:
    - Be honest about quiet weeks. "No major regression" is a valid headline.
    - Use prior-week context to call out persistence ("third week of deployer pain"),
      not just current-week numbers.
    - Reference deterministic comparison data from the report (deltas, severity
      counts) over your own counting.
    - Never fabricate issue numbers, PR references, or quote text.
    - If you have no prior-week observations and no earlier weekly user
      messages on this thread, leave "recurring" empty and do not invent
      history. Headline and movement should also avoid recurrence framing in
      that case.
  `,
  model: 'openrouter/openai/gpt-5.4',
  memory: briefingMemory,
});
