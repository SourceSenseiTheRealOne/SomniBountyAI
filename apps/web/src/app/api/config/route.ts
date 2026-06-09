export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    somniaRpcUrl:
      process.env.SOMNIA_RPC_URL ??
      process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ??
      "https://api.infra.testnet.somnia.network/",
    somniBountyAddress:
      process.env.SOMNIBOUNTY_ADDRESS ?? process.env.NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS ?? "",
    vulnerabilityRegistryAddress:
      process.env.VULNERABILITY_REGISTRY_ADDRESS ??
      process.env.NEXT_PUBLIC_VULNERABILITY_REGISTRY_ADDRESS ??
      "",
  });
}
