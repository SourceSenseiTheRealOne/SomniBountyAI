export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error: "Deprecated. Use POST /api/ipfs/proof for Somnia-compatible proof pinning.",
    },
    { status: 410 },
  );
}
