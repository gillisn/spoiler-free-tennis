import { NextRequest } from "next/server";
import { ImageResponse } from "@vercel/og";
import sharp from "sharp";
import { getDigest } from "@/lib/supabase";

// Node runtime (not edge) so we can pipe the rendered PNG through sharp to
// produce a JPEG — Instagram's Graph API only accepts JPEG for image_url.
export const runtime = "nodejs";

const GREEN = "#0B3D2E";
const LINE = "#1E5C45";
const CREAM = "#F4EFE6";
const ACCENT = "#D7F26D"; // tennis-ball-ish accent, used sparingly

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("d") ?? undefined;
  const digest = await getDigest(date);

  if (!digest || digest.matches.length === 0) {
    return new Response("No digest available yet.", { status: 404 });
  }

  const top = digest.matches.slice(0, 5);

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1350px",
          display: "flex",
          flexDirection: "column",
          backgroundColor: GREEN,
          padding: "72px 80px",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", marginBottom: "48px" }}>
          <div style={{ display: "flex", color: ACCENT, fontSize: 28, letterSpacing: 4, fontWeight: 700 }}>
            SPOILERFREETENNIS.COM
          </div>
          <div style={{ display: "flex", color: CREAM, fontSize: 56, fontWeight: 800, marginTop: 12 }}>
            {digest.tournament}
          </div>
          <div style={{ display: "flex", color: CREAM, fontSize: 40, fontWeight: 600, opacity: 0.85 }}>
            Top 5 To Watch
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          {top.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                borderTop: `2px solid ${LINE}`,
                paddingTop: "20px",
                paddingBottom: "20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <div style={{ display: "flex", color: ACCENT, fontSize: 40, fontWeight: 800, width: 70 }}>
                  {m.rank}
                </div>
                <div style={{ display: "flex", color: CREAM, fontSize: 40, fontWeight: 700 }}>
                  {m.playerA} vs. {m.playerB}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  color: CREAM,
                  fontSize: 26,
                  opacity: 0.85,
                  marginLeft: 70,
                  gap: 16,
                }}
              >
                <div style={{ display: "flex", color: ACCENT }}>★ {m.rating.toFixed(1)}/10</div>
                <div style={{ display: "flex" }}>{m.tag}</div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            color: CREAM,
            fontSize: 24,
            opacity: 0.65,
            marginTop: "40px",
            justifyContent: "center",
          }}
        >
          No scores. No times. Just what to watch.
        </div>
      </div>
    ),
    { width: 1080, height: 1350 }
  );

  const pngBuffer = Buffer.from(await image.arrayBuffer());
  const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 92 }).toBuffer();

  return new Response(jpegBuffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=300",
    },
  });
}
