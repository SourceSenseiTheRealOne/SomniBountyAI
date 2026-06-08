export const runtime = "nodejs";

export function GET() {
  return Response.json({
    ok: true,
    service: "somnibounty-web",
    timestamp: new Date().toISOString(),
  });
}
