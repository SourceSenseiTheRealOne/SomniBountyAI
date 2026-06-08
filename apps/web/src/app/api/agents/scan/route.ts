export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error:
        "Deprecated. Somnia Agents start scans through setupBountyTiers onchain. Use GET /api/repo/snapshot?projectId=... for read-only repo context.",
    },
    { status: 410 },
  );
}
