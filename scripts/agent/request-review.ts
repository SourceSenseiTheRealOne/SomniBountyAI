import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "../../apps/web/src/lib/somnia";
import { somniBountyAbi } from "../../apps/web/src/lib/somnibounty-abi";

const rpcUrl = process.env.SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network/";
const contractAddress = process.env.SOMNIBOUNTY_ADDRESS as `0x${string}` | undefined;
const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const fixId = BigInt(process.env.FIX_ID ?? "1");

if (!contractAddress) throw new Error("Missing SOMNIBOUNTY_ADDRESS");
if (!privateKey) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: somniaTestnet, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: somniaTestnet, transport: http(rpcUrl) });

const fee = await publicClient.readContract({
  address: contractAddress,
  abi: somniBountyAbi,
  functionName: "quoteFixReview",
  args: [fixId],
});

const hash = await walletClient.writeContract({
  address: contractAddress,
  abi: somniBountyAbi,
  functionName: "requestFixReview",
  args: [fixId],
  value: fee > 0n ? fee : parseEther("0.24"),
});

console.log(`Review requested: ${hash}`);
