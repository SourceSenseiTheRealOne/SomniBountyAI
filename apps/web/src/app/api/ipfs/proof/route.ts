import { z } from "zod";
import { jsonError, pinJson } from "@/lib/agents/server";

export const runtime = "nodejs";

const proofSchema = z.object({
  projectId: z.coerce.bigint().positive(),
  jobId: z.coerce.bigint().positive(),
  incidentId: z.coerce.bigint().positive().optional(),
  vulnerabilityTemplateId: z.coerce.bigint().positive().optional(),
  affectedPaths: z.array(z.string().min(1).max(180)).max(20).default([]),
  prUrl: z.url(),
  proofHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  summary: z.string().min(1).max(4_000),
});

export async function POST(request: Request) {
  try {
    const input = proofSchema.parse(await request.json());
    const payload = {
      ...input,
      projectId: input.projectId.toString(),
      jobId: input.jobId.toString(),
      incidentId: input.incidentId?.toString(),
      vulnerabilityTemplateId: input.vulnerabilityTemplateId?.toString(),
      app: "SomniBounty AI",
      schema: "somnibounty.fix-proof.v1",
      createdAt: new Date().toISOString(),
    };

    const ipfsUri = await pinJson(`somnibounty-proof-${payload.projectId}-${payload.jobId}`, payload);
    return Response.json({ ipfsUri, payload });
  } catch (error) {
    return jsonError(error);
  }
}
