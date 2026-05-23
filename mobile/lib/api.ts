import * as FileSystem from "expo-file-system/legacy";

import {
  enqueueAchievements,
  setAchievementsResultScreenActive,
} from "@/lib/achievementsQueue";
import {
  deleteCached,
  getCached,
  invalidatePrefix,
  pruneCacheByPrefix,
  setCached,
  updateCached,
} from "@/lib/cache";
import { localTodayISO } from "@/lib/dayDate";
import {
  readEarnedAchievementIds,
  writeEarnedAchievementIds,
} from "@/lib/earnedAchievements";
import { setPendingPlanCompleted } from "@/lib/planCompletionQueue";
import {
  readLastStreakCelebrationDate,
  setPendingStreakUnlock,
  setStreakResultScreenActive,
} from "@/lib/streakCelebration";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

// Cache key helpers — every screen reads/writes through these so cache and
// API stay in sync after mutations.
export const cacheKeys = {
  plans: (deviceId: string) => `plans:${deviceId}`,
  plan: (planId: string) => `plan:${planId}`,
  profile: (deviceId: string) => `profile:${deviceId}`,
  session: (dayId: string) => `session:${dayId}`,
};

export type PlanDay = {
  id: string;
  day_index: number;
  day_date: string;
  theme: string;
  question: string;
  completed_at: string | null;
};

export type Plan = {
  id: string;
  prep_for: string;
  target_date: string;
  audience_info: string;
  created_at: string;
  days: PlanDay[];
};

export type FillerHit = {
  token: string;
  start: number;
};

export type ProfileActivityPoint = {
  date: string;
  sessions: number;
};

export type ProfileWpmPoint = {
  date: string;
  wpm: number;
};

export type ProfileRatingPoint = {
  date: string;
  rating: number;
};

export type ProfileAchievement = {
  id: string;
  label: string;
  description: string;
  earned: boolean;
  earned_at: string | null;
};

export type Profile = {
  streak_current: number;
  streak_best: number;
  streak_active_today: boolean;
  total_sessions: number;
  total_minutes: number;
  avg_wpm: number | null;
  best_rating: number | null;
  avg_rating: number | null;
  top_filler: string | null;
  plans_count: number;
  activity_365: ProfileActivityPoint[];
  wpm_trend: ProfileWpmPoint[];
  rating_trend: ProfileRatingPoint[];
  achievements: ProfileAchievement[];
};

export type SessionResult = {
  id: string;
  plan_day_id: string;
  audio_duration_s: number;
  audio_url: string | null;
  transcript: string;
  wpm: number;
  filler_count: number;
  top_filler: string | null;
  filler_timestamps: FillerHit[];
  pacing_variation: number;
  rating: number;
  feedback: {
    rating: number;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    audience_fit: string;
    conciseness: string;
    dispersion: string;
  };
  created_at: string;
};

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

export const api = {
  url: API_URL,

  async createPlan(input: {
    device_id: string;
    prep_for: string;
    target_date: string;
    audience_info: string;
  }): Promise<Plan> {
    const res = await fetch(`${API_URL}/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const plan = (await jsonOrThrow(res)) as Plan;
    // Optimistically populate caches so the destination screens render with
    // zero spinner. The plans list cache prepends the new plan; the detail
    // cache stores it directly.
    setCached(cacheKeys.plan(plan.id), plan, { persist: true });
    updateCached<Plan[]>(cacheKeys.plans(input.device_id), (prev) =>
      prev ? [plan, ...prev.filter((p) => p.id !== plan.id)] : [plan],
    );
    // Profile derives from sessions, but plans_count changes — invalidate.
    deleteCached(cacheKeys.profile(input.device_id));
    return plan;
  },

  async getCurrentPlan(device_id: string): Promise<Plan | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(
        `${API_URL}/plans/current?device_id=${encodeURIComponent(device_id)}`,
        { signal: ctrl.signal },
      );
      if (res.status === 200) {
        const body = await res.json();
        return body ?? null;
      }
      return jsonOrThrow(res);
    } finally {
      clearTimeout(t);
    }
  },

  async getPlans(device_id: string): Promise<Plan[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(
        `${API_URL}/plans?device_id=${encodeURIComponent(device_id)}`,
        { signal: ctrl.signal },
      );
      return jsonOrThrow(res);
    } finally {
      clearTimeout(t);
    }
  },

  async getPlan(plan_id: string, device_id: string): Promise<Plan | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(
        `${API_URL}/plans/${encodeURIComponent(plan_id)}?device_id=${encodeURIComponent(device_id)}`,
        { signal: ctrl.signal },
      );
      if (res.status === 404 || res.status === 403) return null;
      return jsonOrThrow(res);
    } finally {
      clearTimeout(t);
    }
  },

  async renamePlan(
    plan_id: string,
    device_id: string,
    prep_for: string,
  ): Promise<Plan> {
    const res = await fetch(
      `${API_URL}/plans/${encodeURIComponent(plan_id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id, prep_for }),
      },
    );
    const plan = (await jsonOrThrow(res)) as Plan;
    setCached(cacheKeys.plan(plan.id), plan, { persist: true });
    updateCached<Plan[]>(cacheKeys.plans(device_id), (prev) =>
      (prev ?? []).map((p) =>
        p.id === plan.id ? { ...p, prep_for: plan.prep_for } : p,
      ),
    );
    return plan;
  },

  async deletePlan(plan_id: string, device_id: string): Promise<void> {
    const res = await fetch(
      `${API_URL}/plans/${encodeURIComponent(plan_id)}?device_id=${encodeURIComponent(device_id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch {}
      throw new Error(`${res.status}: ${detail}`);
    }
    deleteCached(cacheKeys.plan(plan_id));
    updateCached<Plan[]>(cacheKeys.plans(device_id), (prev) =>
      (prev ?? []).filter((p) => p.id !== plan_id),
    );
    deleteCached(cacheKeys.profile(device_id));
  },

  async getProfile(device_id: string): Promise<Profile> {
    const tz = -new Date().getTimezoneOffset();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        `${API_URL}/profile?device_id=${encodeURIComponent(device_id)}&tz_offset_minutes=${tz}`,
        { signal: ctrl.signal },
      );
      return jsonOrThrow(res);
    } finally {
      clearTimeout(t);
    }
  },

  async getSessionForDay(plan_day_id: string): Promise<SessionResult | null> {
    const res = await fetch(
      `${API_URL}/sessions?plan_day_id=${encodeURIComponent(plan_day_id)}`,
    );
    const list = (await jsonOrThrow(res)) as SessionResult[];
    return list[0] ?? null;
  },

  async getPendingPushes(
    device_id: string,
  ): Promise<{ id: string; title: string; body: string; created_at: string }[]> {
    const res = await fetch(
      `${API_URL}/push/pending?device_id=${encodeURIComponent(device_id)}`,
    );
    return jsonOrThrow(res);
  },

  async ackPendingPush(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/push/pending/${encodeURIComponent(id)}/ack`, {
      method: "POST",
    });
    await jsonOrThrow(res);
  },

  async ask(input: {
    device_id: string;
    plan_id?: string | null;
    messages: { role: "user" | "assistant"; content: string }[];
  }): Promise<{ reply: string }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: input.device_id,
          plan_id: input.plan_id ?? null,
          messages: input.messages,
        }),
        signal: ctrl.signal,
      });
      return jsonOrThrow(res);
    } finally {
      clearTimeout(t);
    }
  },

  async getMotivation(input: {
    device_id: string;
    plan_id: string;
  }): Promise<string> {
    // Fallback used when the network call fails or times out. Keep this in
    // pt-PT and aligned with the system prompt's tone so the celebration
    // sequence still reads naturally if Haiku is unreachable.
    const FALLBACK = "Estás um passo mais perto. Mais um treino feito.";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${API_URL}/motivation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: input.device_id,
          plan_id: input.plan_id,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return FALLBACK;
      const body = (await res.json()) as { message?: string };
      const msg = (body.message ?? "").trim();
      return msg || FALLBACK;
    } catch {
      return FALLBACK;
    } finally {
      clearTimeout(t);
    }
  },

  async transcribeAsk(input: {
    device_id: string;
    audio_uri: string;
  }): Promise<{ text: string }> {
    const result = await FileSystem.uploadAsync(
      `${API_URL}/ask/transcribe`,
      input.audio_uri,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "audio",
        mimeType: "audio/m4a",
        parameters: { device_id: input.device_id },
      },
    );
    if (result.status >= 400) {
      let detail = `HTTP ${result.status}`;
      try {
        const body = JSON.parse(result.body);
        if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch {
        if (result.body) detail = result.body.slice(0, 300);
      }
      throw new Error(detail);
    }
    return JSON.parse(result.body) as { text: string };
  },

  async submitSession(input: {
    device_id: string;
    plan_day_id: string;
    audio_uri: string;
  }): Promise<SessionResult> {
    const result = await FileSystem.uploadAsync(`${API_URL}/sessions`, input.audio_uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "audio",
      mimeType: "audio/m4a",
      parameters: {
        device_id: input.device_id,
        plan_day_id: input.plan_day_id,
      },
    });
    if (result.status >= 400) {
      let detail = `HTTP ${result.status}`;
      try {
        const body = JSON.parse(result.body);
        if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch {
        if (result.body) detail = result.body.slice(0, 300);
      }
      throw new Error(detail);
    }
    const session = JSON.parse(result.body) as SessionResult;
    // SWR pattern: write through, don't wipe. Wiping the plan/plans/profile
    // caches makes every screen that subscribes to them flip to its loading
    // spinner the instant the user navigates away — and on slow networks the
    // refetch can stall for 5-8s, which feels like the app is stuck. Instead,
    // patch the cached plan + plans list with the just-completed day so the
    // UI is correct immediately. Profile stays untouched; its useFocusEffect
    // refetches fresh stats silently while the user keeps seeing the old
    // numbers, which is exactly the SWR behavior we want.
    setCached(cacheKeys.session(input.plan_day_id), session);

    const dayId = input.plan_day_id;
    const completedAt = session.created_at;
    const markDayDone = (days: PlanDay[]) =>
      days.map((d) => (d.id === dayId ? { ...d, completed_at: completedAt } : d));

    const cachedPlans = getCached<Plan[]>(cacheKeys.plans(input.device_id));
    if (cachedPlans) {
      const nextPlans = cachedPlans.map((p) =>
        p.days.some((d) => d.id === dayId)
          ? { ...p, days: markDayDone(p.days) }
          : p,
      );
      setCached(cacheKeys.plans(input.device_id), nextPlans, { persist: true });
    }

    const planWithDay = cachedPlans?.find((p) =>
      p.days.some((d) => d.id === dayId),
    );
    if (planWithDay) {
      const cachedPlan = getCached<Plan>(cacheKeys.plan(planWithDay.id));
      if (cachedPlan) {
        setCached(
          cacheKeys.plan(planWithDay.id),
          { ...cachedPlan, days: markDayDone(cachedPlan.days) },
          { persist: true },
        );
      }
    }

    // Plan-completion check: was this the final missing day? We diff *against
    // the pre-write snapshot* so the celebration only fires on the transition
    // (not on subsequent re-submits of an already-completed plan). The cache
    // is the source of truth here — schema has no plan-level `completed_at`
    // and we don't need one for the demo.
    if (planWithDay) {
      const before = planWithDay.days;
      const wasIncomplete = before.some(
        (d) => !d.completed_at && d.id !== dayId,
      );
      const justClosedLastDay =
        !wasIncomplete && before.some((d) => d.id === dayId && !d.completed_at);
      if (justClosedLastDay) {
        // Park the event — the result screen flushes it into the live queue
        // on "VOLTAR AO PLANO" so the overlay doesn't fight the choreography
        // or the rating reveal for screen time.
        setPendingPlanCompleted({
          plan_id: planWithDay.id,
          prep_for: planWithDay.prep_for,
          total_days: planWithDay.days.length,
        });
      }
    }

    // Close the achievement + streak gates synchronously, BEFORE the
    // fire-and-forget IIFE starts. The IIFE awaits the network and may resolve
    // at any moment between now and long after result.tsx has unmounted — by
    // arming up front we guarantee the enqueue/parking happens with the gate
    // already closed, so the cards never paint over the upload-side
    // CelebrationFlow. result.tsx's unmount cleanup opens the gate and
    // promotes pending in one shot. Plan completion doesn't need this — it's
    // parked synchronously above, before the user has navigated anywhere.
    setAchievementsResultScreenActive(true);
    setStreakResultScreenActive(true);

    // Fire-and-forget refresh of the profile cache. The user is about to see
    // the result screen and may tap "Perfil" next; pre-warming the cache here
    // means the tab opens to fresh streak/totals/achievements instead of a
    // spinner. Failures are silent — Perfil's own useFocusEffect will retry.
    //
    // Achievement-unlock detection: read the persisted baseline of earned IDs
    // *before* the refresh, then diff against the fresh response and enqueue
    // anything that flipped from unearned to earned. Baseline lives in
    // AsyncStorage (`mobile/lib/earnedAchievements.ts`) rather than the
    // volatile profile cache so the diff still works on cold start, when
    // pre-warm is still in flight, or after a cache wipe. After the diff we
    // rewrite the baseline so the next session compares against the latest
    // truth.
    (async () => {
      const prevEarnedIds = await readEarnedAchievementIds();
      const prevStreakDate = await readLastStreakCelebrationDate();
      try {
        const p = await api.getProfile(input.device_id);
        setCached(cacheKeys.profile(input.device_id), p, { persist: true });

        // Baseline-drift detection. The persisted earned-IDs set only ever
        // *grows*; if the server-side data was wiped externally (admin
        // "delete db data" during demos), the baseline would shadow every
        // re-earnable achievement and the popup would silently never fire
        // again. Signal: any ID in prevEarnedIds that the server no longer
        // considers earned. When drift is detected, treat the baseline as
        // empty for this diff so re-earned achievements resurface, and
        // clear the streak gate so today can re-celebrate too.
        const currentEarnedIds = new Set(
          p.achievements.filter((a) => a.earned).map((a) => a.id),
        );
        const baselineDrifted = Array.from(prevEarnedIds).some(
          (id) => !currentEarnedIds.has(id),
        );
        const effectivePrevIds = baselineDrifted ? new Set<string>() : prevEarnedIds;
        const effectivePrevStreakDate = baselineDrifted ? null : prevStreakDate;

        const newly = p.achievements.filter(
          (a) => a.earned && !effectivePrevIds.has(a.id),
        );
        await writeEarnedAchievementIds(p.achievements);
        enqueueAchievements(newly);

        // Streak-activation detection: if today's streak is now active and we
        // haven't celebrated this local date yet, park the event. The result
        // screen's unmount cleanup flushes it into the live queue so the
        // overlay paints over /plans (same choreography as plan completion).
        // Gate on the persisted date, not on `streak_active_today` alone:
        // every subsequent same-day session would otherwise re-trigger.
        //
        // IMPORTANT: the gate write moved out of here. We now write it from
        // the StreakUnlockedOverlay's CONTINUAR handler, i.e. only after the
        // user has actually seen and dismissed the celebration. Writing here
        // had a silent failure mode: if the celebration never surfaced (app
        // killed between submit and dismiss, a prior buggy version that
        // seeded the gate, an unmount race), the gate was set to today and
        // the user got locked out for the rest of the day with no way to
        // recover short of clearing AsyncStorage. Writing on dismiss is the
        // only path that guarantees one celebration per local day AND
        // survives those failure modes — if no celebration was shown, the
        // next session simply tries again.
        const today = localTodayISO();
        if (p.streak_active_today && effectivePrevStreakDate !== today) {
          setPendingStreakUnlock({
            streak_current: p.streak_current,
            streak_best: p.streak_best,
            is_new_best:
              p.streak_current >= 2 && p.streak_current === p.streak_best,
          });
        }
      } catch {
        // silent — overlay can wait for the next successful fetch
      }
    })();

    return session;
  },
};

// Re-export cache helpers screens use directly. Keeping them imported via api.ts
// avoids deep `@/lib/cache` imports across every screen.
export {
  deleteCached,
  ensureCacheHydrated,
  getCached,
  invalidatePrefix,
  pruneCacheByPrefix,
  setCached,
  updateCached,
  useCached,
  useSWR,
} from "@/lib/cache";

// Full cache resync. Every refresh in the app (pull-to-refresh on /plans,
// /plan/{id}, profile; useFocusEffect on those screens) routes through here
// so the device-side cache always mirrors what the server has. Two motivating
// scenarios:
//   - During the hackathon we reset Supabase data between tests. Per-screen
//     refreshes only touched one cache key, so a /plans refresh would clear
//     the list but leave stale plan:{id} / profile / session:{dayId} entries
//     until the user happened to revisit each screen.
//   - The server is the source of truth for derived state (achievements,
//     streaks, top filler). Refreshing in one place should pull in the new
//     truth everywhere.
//
// Implementation: fetch plans + profile in parallel via Promise.allSettled
// (one failing shouldn't block the other from updating its cache). On plans
// success we ALSO write each plan into its detail cache (the response already
// carries `days` inline, no extra network) and prune orphan plan + session
// rows. On profile success we update the profile cache. If either fetch
// failed, the first error is rethrown so the caller can surface it.
export async function syncAllCaches(deviceId: string): Promise<void> {
  const [plansResult, profileResult] = await Promise.allSettled([
    api.getPlans(deviceId),
    api.getProfile(deviceId),
  ]);

  let firstError: Error | null = null;

  if (plansResult.status === "fulfilled") {
    const plans = plansResult.value;
    setCached(cacheKeys.plans(deviceId), plans, { persist: true });
    const keepPlan = new Set(plans.map((p) => cacheKeys.plan(p.id)));
    for (const p of plans) {
      setCached(cacheKeys.plan(p.id), p, { persist: true });
    }
    // Drop plan caches for IDs the server no longer knows about — happens
    // after deletePlan from another device or a DB reset during testing.
    pruneCacheByPrefix("plan:", keepPlan);
    // Session caches are tied to plan_days. Cheapest correct policy is to
    // invalidate them all and let the result screen refetch lazily on revisit.
    invalidatePrefix("session:");
  } else {
    firstError =
      plansResult.reason instanceof Error
        ? plansResult.reason
        : new Error(String(plansResult.reason));
  }

  if (profileResult.status === "fulfilled") {
    setCached(cacheKeys.profile(deviceId), profileResult.value, {
      persist: true,
    });
  } else if (!firstError) {
    firstError =
      profileResult.reason instanceof Error
        ? profileResult.reason
        : new Error(String(profileResult.reason));
  }

  if (firstError) throw firstError;
}
