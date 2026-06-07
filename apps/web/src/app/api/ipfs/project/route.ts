import { NextResponse } from "next/server";
import {
  buildProjectMetadataDocument,
  projectMetadataSchema,
  type ProjectMetadataDocument,
} from "@/lib/project-metadata";

export const runtime = "nodejs";

type PinataResponse = {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
  isDuplicate?: boolean;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "somnibounty-project";
}

async function pinProjectMetadata(metadata: ProjectMetadataDocument, projectName: string) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error("Missing PINATA_JWT");
  }

  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: {
        name: `${slugify(projectName)}-metadata.json`,
      },
    }),
  });

  const data = (await response.json().catch(() => null)) as PinataResponse | null;
  if (!response.ok || !data?.IpfsHash) {
    throw new Error(
      data ? `Pinata pin failed with status ${response.status}` : "Pinata pin failed",
    );
  }

  return data;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = projectMetadataSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const metadata = buildProjectMetadataDocument(parsed.data);

  try {
    const pin = await pinProjectMetadata(metadata, parsed.data.name);
    const metadataJson = JSON.stringify(metadata);

    return NextResponse.json({
      cid: pin.IpfsHash,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${pin.IpfsHash}`,
      ipfsUri: `ipfs://${pin.IpfsHash}`,
      metadata,
      metadataJson,
      pinSize: pin.PinSize,
      timestamp: pin.Timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to pin project metadata";
    const status = message === "Missing PINATA_JWT" ? 500 : 502;

    return NextResponse.json({ error: message }, { status });
  }
}
