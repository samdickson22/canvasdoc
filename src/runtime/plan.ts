/** ChatGPT tiers whose Codex access does not include the CLI; the student needs Plus or student credits. */
const WITHOUT_CODEX = new Set(["free", "go"]);

export const STUDENT_PLUS_URL = "https://chatgpt.com/students/2026";
export const STUDENT_CREDITS_URL = "https://developers.openai.com/community/students";

export type PlanStatus =
  | { kind: "ok" }
  | { kind: "needs-plan"; plan: string }
  | { kind: "usage-blocked" };

/** Decides whether to warn before the first message rather than after it fails. */
export function planStatus(plan: string | undefined, usageAllowed: boolean | undefined): PlanStatus {
  if (plan && WITHOUT_CODEX.has(plan)) return { kind: "needs-plan", plan };
  if (usageAllowed === false) return { kind: "usage-blocked" };
  return { kind: "ok" };
}

export type UsageWindows = {
  primary?: { usedPercent: number; resetsAt?: number | null; windowMinutes?: number | null };
  secondary?: { usedPercent: number; resetsAt?: number | null; windowMinutes?: number | null };
};

const windowName = (minutes: number | null | undefined) =>
  !minutes ? undefined : minutes >= 7 * 24 * 60 - 60 ? "week" : minutes >= 24 * 60 - 30 ? "day" : `${Math.round(minutes / 60)}h`;

const resetIn = (resetsAt: number | null | undefined, now: number) => {
  if (!resetsAt) return undefined;
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return "resets now";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `resets in ${Math.round(hours / 24)}d`;
};

/** Short usage line for the composer, e.g. "12% of 5h · 40% of week · resets in 2h 10m". */
export function usageSummary(usage: UsageWindows | undefined, now = Date.now()): { text: string; detail: string; warning: boolean } | undefined {
  if (!usage?.primary && !usage?.secondary) return undefined;
  const parts: string[] = [];
  for (const w of [usage.primary, usage.secondary]) {
    if (!w) continue;
    const name = windowName(w.windowMinutes);
    parts.push(`${Math.max(0, Math.min(100, Math.round(w.usedPercent)))}%${name ? ` of ${name}` : ""}`);
  }
  const worst = Math.max(usage.primary?.usedPercent ?? 0, usage.secondary?.usedPercent ?? 0);
  const soonest = [usage.primary, usage.secondary].filter((w) => w && w.usedPercent >= 100 && w.resetsAt).map((w) => w!.resetsAt!).sort()[0]
    ?? usage.primary?.resetsAt ?? usage.secondary?.resetsAt;
  const reset = resetIn(soonest, now);
  return { text: parts.join(" · "), detail: `Codex usage on this ChatGPT plan: ${parts.join(", ")}${reset ? `; ${reset}` : ""}.`, warning: worst >= 90 };
}

export const planLabel = (plan: string | undefined) =>
  !plan || plan === "unknown" ? undefined : plan === "prolite" ? "Pro Lite" : plan.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
