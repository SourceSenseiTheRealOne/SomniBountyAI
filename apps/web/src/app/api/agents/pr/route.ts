export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error:
        "Deprecated. Use GET /api/fix-pr?jobId=... so PR creation is derived from live Somnia state and remains idempotent.",
    },
    { status: 410 },
  );
}
