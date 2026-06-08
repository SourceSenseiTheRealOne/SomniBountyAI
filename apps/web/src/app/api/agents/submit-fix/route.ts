export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error:
        "Deprecated. Fix submission must be driven by Somnia-verified proof flow, not arbitrary backend calldata.",
    },
    { status: 410 },
  );
}
