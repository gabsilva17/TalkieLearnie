import * as FileSystem from "expo-file-system/legacy";

import {
  deleteCached,
  invalidatePrefix,
  setCached,
  updateCached,
} from "@/lib/cache";

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
    // The session changes plan completion + profile derived stats. Invalidate
    // both so the next focus re-fetches; cache the session itself so the
    // result screen can revisit without a spinner.
    setCached(cacheKeys.session(input.plan_day_id), session);
    invalidatePrefix(`plan:`); // clear all plan:{id} entries
    deleteCached(cacheKeys.plans(input.device_id));
    deleteCached(cacheKeys.profile(input.device_id));
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
  setCached,
  updateCached,
  useCached,
  useSWR,
} from "@/lib/cache";
