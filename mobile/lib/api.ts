import * as FileSystem from "expo-file-system/legacy";

import {
  enqueueAchievements,
  setAchievementsResultScreenActive,
} from "@/lib/achievementsQueue";
import { setPendingPlanCompleted } from "@/lib/planCompletionQueue";
import {
  setPendingStreakUnlock,
  setStreakResultScreenActive,
} from "@/lib/streakCelebration";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

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

export type SessionCelebrations = {
  newly_earned_achievements: ProfileAchievement[];
  streak_just_activated: boolean;
  streak_current: number;
  streak_best: number;
  streak_is_new_best: boolean;
  plan_just_completed: boolean;
  plan_id: string | null;
  plan_prep_for: string | null;
  plan_total_days: number | null;
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
  // Only set on POST /sessions responses; null when fetched via GET.
  celebrations: SessionCelebrations | null;
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
    return (await jsonOrThrow(res)) as Plan;
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
    return (await jsonOrThrow(res)) as Plan;
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

  async reanalyzeSession(input: {
    device_id: string;
    session_id: string;
    transcript: string;
  }): Promise<SessionResult> {
    // Sonnet analysis can run long. Give it up to 30s before giving up — the
    // mobile celebration flow will fall back to the original result if this
    // throws.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(
        `${API_URL}/sessions/${encodeURIComponent(input.session_id)}/reanalyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_id: input.device_id,
            transcript: input.transcript,
          }),
          signal: ctrl.signal,
        },
      );
      return (await jsonOrThrow(res)) as SessionResult;
    } finally {
      clearTimeout(t);
    }
  },

  async submitSession(input: {
    device_id: string;
    plan_day_id: string;
    audio_uri: string;
  }): Promise<SessionResult> {
    // The backend computes the celebration diff (newly-earned achievements,
    // streak activation, plan completion) in the same transaction as the
    // insert and returns it on `session.celebrations`. The client just parks
    // events into the queues — no pre-fetch, no client-side diff, no
    // baselines to go stale.
    const tz = -new Date().getTimezoneOffset();
    const result = await FileSystem.uploadAsync(`${API_URL}/sessions`, input.audio_uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "audio",
      mimeType: "audio/m4a",
      parameters: {
        device_id: input.device_id,
        plan_day_id: input.plan_day_id,
        tz_offset_minutes: String(tz),
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

    const c = session.celebrations;
    if (c) {
      // Plan completion is parked synchronously (no profile fetch needed
      // here — the server already told us).
      if (
        c.plan_just_completed &&
        c.plan_id &&
        c.plan_prep_for &&
        c.plan_total_days != null
      ) {
        setPendingPlanCompleted({
          plan_id: c.plan_id,
          prep_for: c.plan_prep_for,
          total_days: c.plan_total_days,
        });
      }

      // Close the achievement + streak gates synchronously before parking,
      // so result.tsx's mount-time setActive(true) is a no-op and its
      // unmount-time setActive(false) is what releases the pending entries.
      setAchievementsResultScreenActive(true);
      setStreakResultScreenActive(true);

      if (c.newly_earned_achievements.length > 0) {
        enqueueAchievements(c.newly_earned_achievements);
      }
      if (c.streak_just_activated) {
        setPendingStreakUnlock({
          streak_current: c.streak_current,
          streak_best: c.streak_best,
          is_new_best: c.streak_is_new_best,
        });
      }
    }

    return session;
  },
};
