import { env } from "@/modules/core/env";

export function appUrl(path = "/") {
  const base = env.APP_URL.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;

  return `${base}${suffix}`;
}

export function targetUrl(targetId: string) {
  return appUrl(`/targets/${targetId}`);
}
