// Demo clock. Real time in IST, plus an offset (days) an operator can set from /admin
// so a recording can show "two days later" without waiting two days.
import { get } from "./store.js";

const IST_MS = 5.5 * 3600 * 1000;

export async function offsetDays() {
  return Number((await get("clock_offset_days")) || 0);
}

// Date object whose UTC fields read as IST wall-clock time.
export async function nowIST() {
  return new Date(Date.now() + IST_MS + (await offsetDays()) * 86400000);
}

export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export const istStamp = (d) => d.toISOString().replace("T", " ").slice(0, 16) + " IST";
export const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
export const daysBetween = (a, b) => Math.round((parseYmd(ymd(b)) - parseYmd(ymd(a))) / 86400000);
