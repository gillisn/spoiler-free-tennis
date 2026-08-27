import { DailyDigest } from "./types";

const GRAPH_VERSION = "v21.0";

async function graphPost(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Instagram Graph API error: ${JSON.stringify(json.error ?? json)}`);
  }
  return json;
}

/**
 * Publishes a single image post to Instagram: create a media container from
 * a publicly-hosted image URL, then publish it. See lib/README notes in
 * app/api/og/route.tsx for how imageUrl is produced.
 */
export async function postImageToInstagram(imageUrl: string, caption: string): Promise<string> {
  const igId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igId || !accessToken) {
    throw new Error("IG_BUSINESS_ACCOUNT_ID / IG_ACCESS_TOKEN are not set.");
  }

  const container = await graphPost(`/${igId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  });

  const containerId = container.id;
  if (!containerId) throw new Error("Instagram media container creation returned no id.");

  const published = await graphPost(`/${igId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });

  if (!published.id) throw new Error("Instagram media_publish returned no id.");
  return published.id as string;
}

/**
 * Builds the caption text. Kept short and factual on purpose — no scores,
 * no times, no filler. Just what makes each match worth watching and where
 * to find the queue/order on the site.
 */
export function buildCaption(digest: DailyDigest): string {
  const lines: string[] = [];
  lines.push(`${digest.tournament} — Top 5 to Watch`);
  lines.push("");
  digest.matches.forEach((m) => {
    const reason = m.dramaReasons[0] ?? "";
    lines.push(`${m.rank}. ${m.playerA} vs. ${m.playerB}${reason ? ` — ${reason}` : ""}`);
  });
  lines.push("");
  lines.push("No scores. No times. Full breakdown and watch order at spoilerfreetennis.com");
  lines.push("");
  lines.push("#SpoilerFreeTennis #USOpen #Tennis");
  return lines.join("\n");
}
