import { isTauri } from "@typbase/storage";

export type InstallPlatform = "web" | "desktop" | "android" | "ios";

export interface InstallRecord {
  $type: "at.typbase.install";
  platform: InstallPlatform;
  createdAt: string;
  updatedAt: string;
}

function currentPlatform(): InstallPlatform {
  if (!isTauri()) return "web";
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";

  return "desktop";
}

export function installRecordValue(
  existing: unknown,
  platform = currentPlatform(),
  now = new Date().toISOString(),
): InstallRecord | null {
  const previous =
    existing && typeof existing === "object" ? (existing as Partial<InstallRecord>) : null;
  if (previous?.platform === platform) return null;

  return {
    $type: "at.typbase.install",
    platform,
    createdAt:
      typeof previous?.createdAt === "string" && previous.createdAt ? previous.createdAt : now,
    updatedAt: now,
  };
}
