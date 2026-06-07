export const somniBountyAbi = [
  {
    type: "function",
    name: "totalCounts",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "projectCount", type: "uint256" },
      { name: "incidentCount", type: "uint256" },
      { name: "fixCount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getProject",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "active", type: "bool" },
          { name: "metadataHash", type: "bytes32" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getIncident",
    stateMutability: "view",
    inputs: [{ name: "incidentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "projectId", type: "uint256" },
          { name: "sponsor", type: "address" },
          { name: "reporter", type: "address" },
          { name: "bounty", type: "uint96" },
          { name: "deadline", type: "uint64" },
          { name: "severity", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "metadataURI", type: "string" },
          { name: "winningFixId", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getFix",
    stateMutability: "view",
    inputs: [{ name: "fixId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "incidentId", type: "uint256" },
          { name: "fixer", type: "address" },
          { name: "proofURI", type: "string" },
          { name: "proofHash", type: "bytes32" },
          { name: "decision", type: "uint8" },
          { name: "scoreBps", type: "uint16" },
          { name: "resultHash", type: "bytes32" },
          { name: "paid", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "quoteFixReview",
    stateMutability: "view",
    inputs: [{ name: "fixId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "registerProject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadataURI", type: "string" },
      { name: "metadataHash", type: "bytes32" },
    ],
    outputs: [{ name: "projectId", type: "uint256" }],
  },
  {
    type: "function",
    name: "openIncident",
    stateMutability: "payable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "reporter", type: "address" },
      { name: "deadline", type: "uint64" },
      { name: "severity", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "incidentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitFix",
    stateMutability: "nonpayable",
    inputs: [
      { name: "incidentId", type: "uint256" },
      { name: "proofURI", type: "string" },
      { name: "proofHash", type: "bytes32" },
    ],
    outputs: [{ name: "fixId", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestFixReview",
    stateMutability: "payable",
    inputs: [{ name: "fixId", type: "uint256" }],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "reclaimExpired",
    stateMutability: "nonpayable",
    inputs: [{ name: "incidentId", type: "uint256" }],
    outputs: [],
  },
] as const;

