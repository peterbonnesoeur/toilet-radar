import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Function to convert degrees to radians
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// Haversine formula to calculate distance between two lat/lng points in kilometers
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance;
}

// Humans in a hurry think in walking minutes, not map units (~80 m/min).
export function walkingTime(meters: number): string {
  const minutes = Math.max(1, Math.round(meters / 80));
  return minutes === 1 ? '1 min walk' : `${minutes} min walk`;
}

/**
 * Best-effort "open right now" check against free-text opening hours
 * ("24 h", "Mo-So 06:00-23:00", "06:00-22:00", ...).
 * Returns true (open), false (closed), or null (can't tell).
 * Callers should treat null as "unknown", not "closed".
 */
export function isOpenNow(openHours: string | null, now: Date = new Date()): boolean | null {
  if (!openHours) return null;
  const text = openHours.toLowerCase().trim();

  if (/24\s*[h/]|24\s*hours|00[:.]00\s*-\s*24[:.]00/.test(text) || text === '24') {
    return true;
  }

  // Match all HH:MM-HH:MM ranges; if any contains "now", consider it open.
  const ranges = Array.from(text.matchAll(/(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/g));
  if (ranges.length === 0) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const m of ranges) {
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (end === 0) end = 24 * 60;
    const open = start <= end
      ? nowMin >= start && nowMin < end
      : nowMin >= start || nowMin < end; // overnight range (22:00-06:00)
    if (open) return true;
  }
  return false;
}
