"use client";

import { useCallback, useMemo, useState } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { somniaTestnet } from "@/lib/somnia";

type InjectedProvider = EIP1193Provider & {
  isRabby?: boolean;
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  providers?: InjectedProvider[];
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

const somniaChainHex = `0x${somniaTestnet.id.toString(16)}`;

function getInjectedProvider() {
  if (typeof window === "undefined") return null;
  const provider = window.ethereum;
  if (!provider) return null;

  const providers = Array.isArray(provider.providers) ? provider.providers : [];
  return (
    providers.find((candidate) => candidate.isRabby) ??
    providers.find((candidate) => candidate.isOkxWallet) ??
    providers.find((candidate) => !candidate.isMetaMask) ??
    provider
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return "Wallet request failed";
}

export function useSomniaWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [status, setStatus] = useState("Wallet disconnected");

  const walletClient = useMemo<WalletClient | null>(() => {
    const provider = getInjectedProvider();
    if (!provider || !account) return null;
    return createWalletClient({
      account,
      chain: somniaTestnet,
      transport: custom(provider),
    });
  }, [account]);

  const connect = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setStatus("No injected wallet found");
      return null;
    }

    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as Address[];
      const connected = accounts[0];
      if (!connected) {
        setStatus("Wallet locked");
        return null;
      }

      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: somniaChainHex }],
      });

      setAccount(connected);
      setStatus("Connected to Somnia");
      return connected;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
      if (code !== 4902) {
        setStatus(errorMessage(error));
        return null;
      }

      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: somniaChainHex,
              chainName: somniaTestnet.name,
              nativeCurrency: somniaTestnet.nativeCurrency,
              rpcUrls: [...somniaTestnet.rpcUrls.default.http],
              blockExplorerUrls: [somniaTestnet.blockExplorers.default.url],
            },
          ],
        });
        const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
        setAccount(accounts[0] ?? null);
        setStatus(accounts[0] ? "Connected to Somnia" : "Wallet locked");
        return accounts[0] ?? null;
      } catch (addError) {
        setStatus(errorMessage(addError));
        return null;
      }
    }
  }, []);

  return {
    account,
    connect,
    status,
    walletClient,
  };
}
