"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    providers.find((candidate) => candidate.isMetaMask) ??
    providers.find((candidate) => candidate.isOkxWallet) ??
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

  const syncConnectedAccount = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setAccount(null);
      setStatus("No injected wallet found");
      return null;
    }

    try {
      const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
      const connected = accounts[0] ?? null;
      const chainId = (await provider.request({ method: "eth_chainId" })) as string;

      setAccount(connected);
      if (!connected) {
        setStatus("Wallet disconnected");
        return null;
      }

      setStatus(chainId === somniaChainHex ? "Connected to Somnia" : "Switch to Somnia Testnet");
      return connected;
    } catch (error) {
      setAccount(null);
      setStatus(errorMessage(error));
      return null;
    }
  }, []);

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

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;

    const syncTimer = window.setTimeout(() => {
      void syncConnectedAccount();
    }, 0);

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccount = Array.isArray(accounts) ? (accounts[0] as Address | undefined) : undefined;
      setAccount(nextAccount ?? null);
      setStatus(nextAccount ? "Connected to Somnia" : "Wallet disconnected");
    };

    const handleChainChanged = (chainId: unknown) => {
      setStatus(chainId === somniaChainHex ? "Connected to Somnia" : "Switch to Somnia Testnet");
    };

    const handleDisconnect = () => {
      setAccount(null);
      setStatus("Wallet disconnected");
    };

    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);
    provider.on?.("disconnect", handleDisconnect);

    return () => {
      window.clearTimeout(syncTimer);
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
      provider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [syncConnectedAccount]);

  return {
    account,
    connect,
    status,
    walletClient,
  };
}
