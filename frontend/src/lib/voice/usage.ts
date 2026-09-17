/**
 * Voice usage tracking. Per-user, per-day counters in voice_usage.
 * Counters: calls (sessions issued), tool_calls (authenticated voice API
 * calls), emails_sent (email_my_summary invocations).
 */

interface DbLike {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export type VoiceUsageCounter = "calls" | "tool_calls" | "emails_sent";

const COLUMN: Record<VoiceUsageCounter, string> = {
  calls: "calls",
  tool_calls: "tool_calls",
  emails_sent: "emails_sent",
};

export async function incrementVoiceUsage(
  db: DbLike,
  userId: string,
  counter: VoiceUsageCounter,
  amount = 1
): Promise<void> {
  const column = COLUMN[counter];
  try {
    await db.query(
      `INSERT INTO voice_usage (user_id, day, ${column})
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, day)
       DO UPDATE SET ${column} = voice_usage.${column} + $2`,
      [userId, amount]
    );
  } catch (err) {
    // Usage tracking must never break the request path.
    console.error("[voice-usage] increment failed:", (err as Error).message);
  }
}
