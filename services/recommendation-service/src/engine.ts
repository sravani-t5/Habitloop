export interface HourStat { hour: number; done: number; missed: number }
export interface Habit { id: string; name: string; frequencyPerWeek: number; scheduledTime: string }
export interface Suggestion { activityId: string; type: "timing" | "frequency"; currentValue: string; suggestedValue: string; rationale: string; confidence: number }

const rate = (h?: HourStat) => (h && h.done + h.missed ? h.done / (h.done + h.missed) : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Pure function: habit + hourly completion history -> suggestions. */
export function suggest(habit: Habit, hours: HourStat[]): Suggestion[] {
  const out: Suggestion[] = [];
  const total = hours.reduce((n, h) => n + h.done + h.missed, 0);
  if (total < 5) return out; // not enough data to say anything useful

  // TIMING: best hour (min 3 samples) beats the scheduled hour by >= 15 points
  const sched = Number(habit.scheduledTime.slice(0, 2));
  const best = hours.filter((h) => h.done + h.missed >= 3)
    .sort((a, b) => rate(b) - rate(a) || (b.done + b.missed) - (a.done + a.missed))[0];
  if (best && best.hour !== sched) {
    const cur = hours.find((h) => h.hour === sched);
    const gain = rate(best) - rate(cur);
    if (gain >= 0.15) out.push({
      activityId: habit.id, type: "timing", currentValue: habit.scheduledTime, suggestedValue: hh(best.hour),
      rationale: `You complete "${habit.name}" ${pct(rate(best))} of the time around ${hh(best.hour)}, versus ${pct(rate(cur))} at ${habit.scheduledTime}.`,
      confidence: Math.min(0.95, Math.round((0.5 + Math.min(total, 30) / 60 + gain / 4) * 100) / 100),
    });
  }

  // FREQUENCY: very consistent -> stretch; struggling -> ease off
  const overall = hours.reduce((n, h) => n + h.done, 0) / total;
  if (total >= 8 && overall >= 0.9 && habit.frequencyPerWeek < 7) out.push({
    activityId: habit.id, type: "frequency", currentValue: `${habit.frequencyPerWeek}x/week`, suggestedValue: `${habit.frequencyPerWeek + 1}x/week`,
    rationale: `You have completed ${pct(overall)} of "${habit.name}" sessions. You are ready for one more day a week.`, confidence: 0.7,
  });
  if (total >= 8 && overall < 0.4 && habit.frequencyPerWeek > 1) out.push({
    activityId: habit.id, type: "frequency", currentValue: `${habit.frequencyPerWeek}x/week`, suggestedValue: `${habit.frequencyPerWeek - 1}x/week`,
    rationale: `Only ${pct(overall)} of "${habit.name}" sessions were completed. A lighter schedule builds consistency first.`, confidence: 0.65,
  });
  return out;
}
