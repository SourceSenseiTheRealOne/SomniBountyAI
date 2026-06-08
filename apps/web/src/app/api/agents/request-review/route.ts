export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error:
        "Deprecated. Somnia verifier review must be requested through onchain contract state, not an arbitrary backend endpoint.",
    },
    { status: 410 },
  );
}
