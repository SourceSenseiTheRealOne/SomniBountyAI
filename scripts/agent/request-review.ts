console.log(
  [
    "SomniBounty AI no longer uses this helper for runtime review requests.",
    "Current flow:",
    "1. Fund tiers through SomniBountyAI.setupBountyTiers.",
    "2. Somnia Agent scan callback opens the incident.",
    "3. Backend support uses GET /api/fix-pr?jobId=... for idempotent PR creation.",
    "4. Proof is pinned through POST /api/ipfs/proof.",
    "5. Somnia verifier callback gates payout.",
    "",
    "Keep direct scripts out of the payout path unless the contract flow is explicitly redesigned.",
  ].join("\n"),
);
