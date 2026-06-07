"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useForm } from "react-hook-form";
import { useSomniaWallet } from "@/hooks/use-somnia-wallet";
import {
  hashText,
  type UiIncident,
  type UiProject,
  useSomniBounty,
} from "@/hooks/use-somnibounty";
import {
  projectMetadataSchema,
  type ProjectMetadataFormValues,
} from "@/lib/project-metadata";

type ActionPanel = "register" | "incident" | "fix" | null;

type ProjectIpfsResponse = {
  ipfsUri: string;
  metadataJson: string;
};

const zeroAddress = "0x0000000000000000000000000000000000000000";

const mockProjects: UiProject[] = [
  {
    id: "PRJ-001",
    name: "AstraVault",
    owner: "0xA11C...E001",
    metadataURI: "ipfs://bafy-astra-vault",
    hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
  {
    id: "PRJ-002",
    name: "Naiad Markets",
    owner: "0xB0B0...B002",
    metadataURI: "ipfs://bafy-naiad-markets",
    hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
];

const mockIncidents: UiIncident[] = [
  {
    id: "INC-031",
    name: "Critical Reentrancy",
    project: "AstraVault",
    severity: "Critical",
    bounty: "1,250 STT",
    status: "Verification Pending",
    confidence: 92,
    proof: "Fix PR #128",
    vector: "External call before balance sync",
  },
  {
    id: "INC-027",
    name: "Oracle Drift Window",
    project: "Naiad Markets",
    severity: "High",
    bounty: "840 STT",
    status: "Needs Review",
    confidence: 78,
    proof: "Patch commit 5db8",
    vector: "Stale price acceptance after sequencer lag",
  },
  {
    id: "INC-022",
    name: "Allowance Shadow Path",
    project: "SignalSwap",
    severity: "Medium",
    bounty: "410 STT",
    status: "Fix Validated",
    confidence: 96,
    proof: "Deployment 0x9a...31",
    vector: "Permit replay on alternate domain separator",
  },
];

const loop = ["Observe", "Investigate", "Reason", "Act", "Verify", "Pay"];
const twitterUrl = "https://twitter.com/";

function IconMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path
        d="M24 4 39 10.2v11.7c0 9.7-5.8 17.6-15 22.1C14.8 39.5 9 31.6 9 21.9V10.2L24 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M17 24.2 22 29l9.5-11.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function BootLoader() {
  const checks = ["Observe", "Investigate", "Reason", "Act", "Verify", "Pay"];

  return (
    <motion.div
      className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center overflow-hidden bg-[#02050a] px-6 text-foreground"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(18px)" }}
      transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }}
      aria-label="Loading SomniBounty AI"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(73,247,169,0.22),transparent_30rem),radial-gradient(circle_at_76%_24%,rgba(94,231,255,0.16),transparent_34rem),radial-gradient(circle_at_52%_72%,rgba(164,139,255,0.15),transparent_30rem),linear-gradient(160deg,#02050a,#04110f_42%,#010305)]" />
      <motion.div
        aria-hidden="true"
        className="absolute h-[32rem] w-[32rem] rounded-full border border-emerald-200/12"
        animate={{ rotate: 360, scale: [1, 1.05, 1] }}
        transition={{ rotate: { duration: 18, repeat: Infinity, ease: "linear" }, scale: { duration: 3.2, repeat: Infinity, ease: [0.32, 0.72, 0, 1] } }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute h-[22rem] w-[22rem] rounded-full border border-cyan-200/14"
        animate={{ rotate: -360 }}
        transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute h-60 w-60 rounded-full opacity-80 blur-[2px] [background:conic-gradient(from_0deg,transparent,rgba(73,247,169,0.75),rgba(94,231,255,0.62),rgba(164,139,255,0.48),transparent)] [mask:radial-gradient(closest-side,transparent_68%,#000_70%)]"
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      <div className="relative z-10 flex w-full max-w-[34rem] flex-col items-center text-center">
        <motion.div
          className="glow-ring grid h-20 w-20 place-items-center rounded-full border border-emerald-200/18 bg-emerald-300/10 text-emerald-100 shadow-[0_0_80px_rgba(73,247,169,0.25)]"
          animate={{ scale: [1, 1.08, 1], boxShadow: ["0 0 40px rgba(73,247,169,0.18)", "0 0 86px rgba(73,247,169,0.34)", "0 0 40px rgba(73,247,169,0.18)"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
        >
          <IconMark className="h-10 w-10" />
        </motion.div>

        <motion.p
          className="iris-text mt-8 font-display text-3xl font-semibold tracking-tight sm:text-4xl"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
        >
          SomniBounty AI
        </motion.p>
        <motion.p
          className="mt-3 max-w-md text-sm leading-6 text-emerald-50/62 sm:text-base"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.32, 0.72, 0, 1] }}
        >
          Booting autonomous security triage and bounty escrow.
        </motion.p>

        <div className="mt-8 grid w-full grid-cols-2 gap-2 sm:grid-cols-6">
          {checks.map((check, index) => (
            <motion.div
              key={check}
              className="rounded-full border border-emerald-200/14 bg-white/[0.035] px-3 py-2 font-mono text-[0.68rem] text-emerald-100/78 backdrop-blur-md"
              initial={{ opacity: 0.2, y: 8 }}
              animate={{ opacity: [0.28, 1, 0.58], y: 0 }}
              transition={{
                duration: 1.1,
                delay: index * 0.24,
                repeat: Infinity,
                repeatDelay: 1.4,
                ease: [0.32, 0.72, 0, 1],
              }}
            >
              {check}
            </motion.div>
          ))}
        </div>

        <div className="mt-8 h-1.5 w-full overflow-hidden rounded-full border border-emerald-200/14 bg-white/[0.045]">
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--emerald),var(--cyan),var(--violet),var(--gold))] shadow-[0_0_22px_rgba(73,247,169,0.48)]"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 4, ease: [0.32, 0.72, 0, 1] }}
          />
        </div>
      </div>
    </motion.div>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6.5 6.5l11 11m0-11-11 11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M7 17 17 7m0 0H8.8M17 7v8.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CommandButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="group relative flex min-h-11 items-center justify-between gap-3 overflow-hidden rounded-full border border-emerald-200/15 bg-emerald-200/[0.06] py-1.5 pr-1.5 pl-5 text-sm text-emerald-50 backdrop-blur-md transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-emerald-200/40 hover:bg-emerald-200/[0.12] hover:shadow-[0_0_28px_rgba(73,247,169,0.18)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/12 to-transparent transition-transform duration-1000 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-full" />
      <span className="relative font-medium tracking-tight">{children}</span>
      <span className="relative grid h-8 w-8 place-items-center rounded-full bg-emerald-200/16 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(73,247,169,0.25)] transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:-translate-y-0.5">
        <ArrowGlyph />
      </span>
    </button>
  );
}

function HowItWorksModal({ close }: { close: () => void }) {
  const steps = [
    ["Observe", "Agents watch project evidence, repos, deployments, and public reports."],
    ["Investigate", "Evidence URI and hash anchor the incident while long context stays offchain."],
    ["Reason", "Verifier agent classifies the submitted fix as VALID, INVALID, or NEEDS_REVIEW."],
    ["Act", "The contract stores the review request and waits for the authenticated callback."],
    ["Verify", "A valid callback deletes the pending request before any payout can happen."],
    ["Pay", "Only VALID releases the escrowed STT bounty. Expired unresolved incidents can be reclaimed."],
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center bg-black/62 px-4 py-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-it-works-title"
    >
      <motion.div
        className="bezel w-full max-w-3xl rounded-[1.85rem] p-1.5"
        initial={{ y: 28, scale: 0.97, opacity: 0, filter: "blur(12px)" }}
        animate={{ y: 0, scale: 1, opacity: 1, filter: "blur(0px)" }}
        exit={{ y: 18, scale: 0.98, opacity: 0, filter: "blur(10px)" }}
        transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bezel-core rounded-[1.45rem] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-200/70">
                proofguard loop
              </p>
              <h2
                id="how-it-works-title"
                className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
              >
                How It Works
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/68 sm:text-base">
                SomniBounty turns vulnerability evidence into an onchain incident, sends fix proof to
                an agent verifier, then releases bounty escrow only after a valid callback.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close how it works dialog"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-emerald-50 transition-all duration-500 hover:border-emerald-200/35 hover:bg-emerald-200/[0.12]"
            >
              <CloseGlyph />
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {steps.map(([title, body], index) => (
              <motion.div
                key={title}
                className="chip-glass rounded-[1.1rem] p-4"
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  duration: 0.45,
                  delay: 0.08 + index * 0.04,
                  ease: [0.32, 0.72, 0, 1],
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-200/20 bg-emerald-300/10 font-mono text-xs text-emerald-100">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="font-display text-base font-semibold text-white">{title}</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SeverityRail({ severity }: { severity: UiIncident["severity"] }) {
  const color =
    severity === "Critical"
      ? "from-rose-400 via-amber-300 to-amber-200 shadow-[0_0_12px_rgba(255,95,122,0.55)]"
      : severity === "High"
        ? "from-cyan-300 via-sky-300 to-emerald-300 shadow-[0_0_12px_rgba(94,231,255,0.5)]"
        : "from-emerald-300 via-lime-200 to-lime-100 shadow-[0_0_12px_rgba(73,247,169,0.45)]";

  return <span className={`h-10 w-1 shrink-0 rounded-full bg-gradient-to-b ${color}`} />;
}

function GradientIncidentField({ selected }: { selected: UiIncident }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.div
        aria-hidden="true"
        className="absolute -top-28 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_45%_40%,rgba(73,247,169,0.55),rgba(18,153,117,0.24)_34%,transparent_68%)] blur-2xl"
        animate={{ scale: [1, 1.08, 1], opacity: [0.68, 0.92, 0.68] }}
        transition={{ duration: 8, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute right-[-12%] top-10 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(94,231,255,0.32),transparent_66%)] blur-2xl"
        animate={{ x: [0, -24, 0], y: [0, 18, 0], opacity: [0.5, 0.82, 0.5] }}
        transition={{ duration: 10, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute bottom-[-18%] left-[-8%] h-[22rem] w-[22rem] rounded-full bg-[radial-gradient(circle,rgba(232,198,106,0.28),transparent_68%)] blur-2xl"
        animate={{ x: [0, 26, 0], opacity: [0.34, 0.64, 0.34] }}
        transition={{ duration: 9, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute bottom-[-10%] right-[-6%] h-[20rem] w-[20rem] rounded-full bg-[radial-gradient(circle,rgba(164,139,255,0.3),transparent_66%)] blur-2xl"
        animate={{ x: [0, -22, 0], y: [0, -16, 0], opacity: [0.32, 0.6, 0.32] }}
        transition={{ duration: 11, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
      />

      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.08),transparent_24%,rgba(73,247,169,0.08)_48%,transparent_72%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_36%,rgba(0,0,0,0.54)_78%)]" />

      <motion.div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-[2px] [background:conic-gradient(from_0deg,rgba(73,247,169,0.0),rgba(73,247,169,0.5),rgba(94,231,255,0.45),rgba(164,139,255,0.4),rgba(240,205,110,0.35),rgba(73,247,169,0.0))] [mask:radial-gradient(closest-side,transparent_67%,#000_69%)]"
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3.2rem] border border-emerald-200/30 bg-emerald-200/8 shadow-[0_0_90px_rgba(73,247,169,0.26),inset_0_0_40px_rgba(94,231,255,0.12)] backdrop-blur-[1px]"
        animate={{ rotate: [45, 52, 45], scale: [1, 1.04, 1] }}
        transition={{ duration: 7, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/18"
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--gold)]/20"
        animate={{ rotate: [360, 0] }}
        transition={{ duration: 36, repeat: Infinity, ease: "linear" }}
      />

      <div className="absolute inset-x-0 top-[43%] h-px bg-gradient-to-r from-transparent via-emerald-200/45 to-transparent" />
      <div className="absolute inset-y-0 left-[52%] w-px bg-gradient-to-b from-transparent via-cyan-200/28 to-transparent" />
      <div className="absolute bottom-8 left-8 right-8 grid grid-cols-3 gap-3">
        {[
          ["Vector", selected.vector],
          ["Proof", selected.proof],
          ["Bounty", selected.bounty],
        ].map(([label, value]) => (
          <div key={label} className="chip-glass rounded-[1rem] p-4 transition-colors duration-700 hover:border-emerald-200/30">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              {label}
            </p>
            <p className="mt-2 text-sm font-medium text-white">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionDrawer({
  account,
  activePanel,
  close,
  selected,
  submit,
}: {
  account: `0x${string}` | null;
  activePanel: ActionPanel;
  close: () => void;
  selected: UiIncident;
  submit: {
    registerProject: (metadataURI: string, metadataHash: `0x${string}`) => Promise<unknown>;
    openIncident: (
      projectId: bigint,
      reporter: `0x${string}`,
      deadline: bigint,
      severity: number,
      evidenceHash: `0x${string}`,
      metadataURI: string,
      bountyStt: string,
    ) => Promise<unknown>;
    submitFix: (incidentId: bigint, proofURI: string, proofHash: `0x${string}`) => Promise<unknown>;
  };
}) {
  const {
    register: registerProjectField,
    handleSubmit: handleProjectSubmit,
    formState: { errors: projectErrors },
  } = useForm<ProjectMetadataFormValues>({
    resolver: zodResolver(projectMetadataSchema),
    defaultValues: {
      name: "AstraVault",
      description:
        "A Somnia-native vault protocol using SomniBounty AI for autonomous security triage and bounty escrow.",
      imageUrl: "https://somnibounty.ai/project-card.png",
      githubRepo: "https://github.com/demo/protocol",
    },
  });
  const [incidentProjectId, setIncidentProjectId] = useState("1");
  const [incidentMetadata, setIncidentMetadata] = useState("critical-reentrancy-demo");
  const [evidence, setEvidence] = useState("external call before balance sync");
  const [severity, setSeverity] = useState("5");
  const [bounty, setBounty] = useState("0.01");
  const [deadlineHours, setDeadlineHours] = useState("24");
  const [fixIncidentId, setFixIncidentId] = useState(
    selected.numericIncidentId ? selected.numericIncidentId.toString() : "1",
  );
  const [proofURI, setProofURI] = useState("https://github.com/demo/protocol/pull/128");
  const [proofText, setProofText] = useState("Fix PR #128 moves state update before external call");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!activePanel) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      close();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function pinAndRegisterProject(values: ProjectMetadataFormValues) {
    const response = await fetch("/api/ipfs/project", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
    });
    const data = (await response.json().catch(() => null)) as
      | (ProjectIpfsResponse & { error?: string })
      | null;

    if (!response.ok || !data?.ipfsUri || !data.metadataJson) {
      throw new Error(data?.error ?? "Unable to pin project metadata to IPFS");
    }

    await submit.registerProject(data.ipfsUri, hashText(data.metadataJson));
  }

  const title =
    activePanel === "register"
      ? "Register project"
      : activePanel === "incident"
        ? "Open funded incident"
        : "Submit fix proof";

  return (
    <div className="fixed inset-0 z-30 grid place-items-end bg-black/65 px-4 py-5 backdrop-blur-md sm:place-items-center">
      <div className="bezel w-full max-w-lg rounded-[1.85rem] p-1.5">
        <form
          className="bezel-core rounded-[1.45rem] p-5"
          onSubmit={(event) => {
            if (activePanel === "register") {
              void handleProjectSubmit((values) => run(() => pinAndRegisterProject(values)))(event);
              return;
            }

            event.preventDefault();
            if (activePanel === "incident") {
              const deadline = BigInt(
                Math.floor(Date.now() / 1000) + Math.max(1, Number(deadlineHours)) * 3600,
              );
              void run(() =>
                submit.openIncident(
                  BigInt(incidentProjectId || "1"),
                  account ?? zeroAddress,
                  deadline,
                  Number(severity),
                  hashText(evidence),
                  incidentMetadata,
                  bounty,
                ),
              );
            }
            if (activePanel === "fix") {
              void run(() => submit.submitFix(BigInt(fixIncidentId || "1"), proofURI, hashText(proofText)));
            }
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-200/70">
                onchain action
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-white">{title}</h2>
            </div>
            <button
              type="button"
              onClick={close}
              className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/10 text-emerald-50 transition-all duration-500 hover:rotate-90 hover:border-rose-300/40 hover:text-rose-200"
            >
              X
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {activePanel === "register" && (
              <>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Project name
                  <input
                    {...registerProjectField("name")}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                  {projectErrors.name?.message ? (
                    <span className="mt-1 block text-xs text-rose-200">{projectErrors.name.message}</span>
                  ) : null}
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Description
                  <textarea
                    {...registerProjectField("description")}
                    rows={4}
                    className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/10 bg-black/30 px-4 py-3 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                  {projectErrors.description?.message ? (
                    <span className="mt-1 block text-xs text-rose-200">
                      {projectErrors.description.message}
                    </span>
                  ) : null}
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Image URL
                  <input
                    {...registerProjectField("imageUrl")}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                  {projectErrors.imageUrl?.message ? (
                    <span className="mt-1 block text-xs text-rose-200">
                      {projectErrors.imageUrl.message}
                    </span>
                  ) : null}
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  GitHub repo link
                  <input
                    {...registerProjectField("githubRepo")}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                  {projectErrors.githubRepo?.message ? (
                    <span className="mt-1 block text-xs text-rose-200">
                      {projectErrors.githubRepo.message}
                    </span>
                  ) : null}
                </label>
                <p className="rounded-[0.9rem] border border-emerald-200/10 bg-emerald-200/[0.045] px-3 py-2 text-xs leading-5 text-emerald-50/62">
                  Metadata JSON is pinned to IPFS with Pinata, then the resulting IPFS URI and
                  metadata hash are written to the contract.
                </p>
              </>
            )}

            {activePanel === "incident" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-[var(--ink-muted)]">
                    Project ID
                    <input
                      value={incidentProjectId}
                      onChange={(event) => setIncidentProjectId(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                    />
                  </label>
                  <label className="block text-sm text-[var(--ink-muted)]">
                    Bounty STT
                    <input
                      value={bounty}
                      onChange={(event) => setBounty(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                    />
                  </label>
                </div>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Incident metadata
                  <input
                    value={incidentMetadata}
                    onChange={(event) => setIncidentMetadata(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-[var(--ink-muted)]">
                    Severity
                    <input
                      value={severity}
                      onChange={(event) => setSeverity(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                    />
                  </label>
                  <label className="block text-sm text-[var(--ink-muted)]">
                    Deadline hours
                    <input
                      value={deadlineHours}
                      onChange={(event) => setDeadlineHours(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                    />
                  </label>
                </div>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Evidence text
                  <input
                    value={evidence}
                    onChange={(event) => setEvidence(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                </label>
              </>
            )}

            {activePanel === "fix" && (
              <>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Incident ID
                  <input
                    value={fixIncidentId}
                    onChange={(event) => setFixIncidentId(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Proof URI
                  <input
                    value={proofURI}
                    onChange={(event) => setProofURI(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                </label>
                <label className="block text-sm text-[var(--ink-muted)]">
                  Proof hash text
                  <input
                    value={proofText}
                    onChange={(event) => setProofText(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-[0.9rem] border border-white/10 bg-black/30 px-4 text-white outline-none backdrop-blur-sm transition-all duration-500 focus:border-emerald-200/45 focus:bg-black/40 focus:shadow-[0_0_0_3px_rgba(73,247,169,0.12)]"
                  />
                </label>
              </>
            )}
          </div>

          {actionError ? (
            <p className="mt-4 rounded-[0.9rem] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-sm leading-5 text-rose-100">
              {actionError}
            </p>
          ) : null}

          <button
            disabled={busy}
            className="mt-6 min-h-11 w-full rounded-full border border-emerald-200/25 bg-emerald-200/[0.14] text-sm font-medium text-emerald-50 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-emerald-200/45 hover:bg-emerald-200/[0.22] hover:shadow-[0_0_30px_rgba(73,247,169,0.25)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (activePanel === "register" ? "Pinning to IPFS..." : "Confirming...") : title}
          </button>
        </form>
      </div>
    </div>
  );
}

export function SecurityConsole() {
  const wallet = useSomniaWallet();
  const bounty = useSomniBounty(wallet.walletClient, wallet.account);
  const projects = bounty.projects.length > 0 ? bounty.projects : mockProjects;
  const incidents = bounty.incidents.length > 0 ? bounty.incidents : mockIncidents;
  const [selectedId, setSelectedId] = useState("INC-031");
  const [activePanel, setActivePanel] = useState<ActionPanel>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const selected = useMemo(
    () => incidents.find((incident) => incident.id === selectedId) ?? incidents[0],
    [incidents, selectedId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setIsBooting(false), 4_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showHowItWorks) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setShowHowItWorks(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showHowItWorks]);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="noise scanlines relative min-h-[100dvh] overflow-hidden px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <div className="aurora" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_center,rgba(73,247,169,0.15),transparent_54%)]" />
      <AnimatePresence>{isBooting ? <BootLoader /> : null}</AnimatePresence>
      <AnimatePresence>
        {showHowItWorks ? <HowItWorksModal close={() => setShowHowItWorks(false)} /> : null}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isBooting ? 0 : 1 }}
        transition={{ duration: 0.8, delay: isBooting ? 0 : 0.18, ease: [0.32, 0.72, 0, 1] }}
      >
        <motion.nav
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: isBooting ? -24 : 0, opacity: isBooting ? 0 : 1 }}
          transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
          className="relative z-20 mx-auto flex max-w-[95rem] items-center justify-between rounded-full border border-emerald-100/12 bg-black/32 px-3 py-2 shadow-[0_22px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
        >
        <div className="flex items-center gap-3">
          <span className="glow-ring grid h-10 w-10 place-items-center rounded-full border border-emerald-200/18 bg-emerald-300/10 text-emerald-200">
            <IconMark className="h-5 w-5" />
          </span>
          <div>
            <p className="iris-text font-display text-base font-semibold tracking-[0.01em]">
              SomniBounty AI
            </p>
            <p className="hidden items-center gap-1.5 text-xs text-[var(--ink-muted)] sm:flex">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
              autonomous security triage
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-sm text-emerald-50/70 lg:flex">
          {[
            { label: "How It Works", action: () => setShowHowItWorks(true) },
            { label: "Publish Bounty", action: () => setActivePanel("register") },
            { label: "Fix Review", action: () => scrollToSection("fix-review-panel") },
            { href: twitterUrl, label: "Follow us on Twitter" },
          ].map((item) =>
            "href" in item ? (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="grid min-h-11 place-items-center rounded-full px-4 transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/8 hover:text-white"
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="min-h-11 rounded-full px-4 transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/8 hover:text-white"
              >
                {item.label}
              </button>
            ),
          )}
        </div>
        <button
          onClick={wallet.connect}
          className="min-h-11 rounded-full border border-cyan-200/25 bg-cyan-200/[0.08] px-5 text-sm font-medium tracking-tight text-cyan-50 backdrop-blur-md transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-cyan-200/45 hover:bg-cyan-200/[0.16] hover:shadow-[0_0_26px_rgba(94,231,255,0.28)] active:scale-[0.98]"
        >
          {wallet.account ? `${wallet.account.slice(0, 6)}...${wallet.account.slice(-4)}` : "Connect"}
        </button>
        </motion.nav>

      <section className="relative z-10 mx-auto grid max-w-[95rem] gap-5 pt-8 lg:grid-cols-[18rem_minmax(0,1fr)_22rem] xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
        <motion.aside
          id="incidents-panel"
          initial={{ x: -32, opacity: 0, filter: "blur(10px)" }}
          animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.95, ease: [0.32, 0.72, 0, 1], delay: 0.1 }}
          className="bezel rounded-[1.85rem] p-1.5"
        >
          <div className="bezel-core scrollbar-thin max-h-[calc(100dvh-8.5rem)] overflow-auto rounded-[1.45rem] p-4">
            <div className="mb-5">
              <h1 className="font-display text-2xl font-semibold leading-tight text-white">
                Live Projects
              </h1>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <span className="chip-glass flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs text-emerald-200">
                  <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  {String(projects.length).padStart(2, "0")} projects
                </span>
                <span className="chip-glass rounded-full px-2.5 py-1 text-center font-mono text-xs text-cyan-100">
                  {String(incidents.length).padStart(2, "0")} incidents
                </span>
              </div>
            </div>

            <div className="mb-6 space-y-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-[1.1rem] border border-cyan-200/14 bg-cyan-200/[0.045] p-3 transition-all duration-700 hover:-translate-y-px hover:border-cyan-200/28 hover:bg-cyan-200/[0.075]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[0.72rem] text-cyan-100/82">{project.id}</span>
                    <span className="rounded-full border border-emerald-200/16 bg-emerald-300/10 px-2 py-0.5 font-mono text-[0.66rem] text-emerald-100">
                      LIVE
                    </span>
                  </div>
                  <p className="mt-2 font-display text-sm font-semibold text-white">
                    {project.name}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                    {project.owner} - {project.metadataURI.startsWith("ipfs://") ? "IPFS metadata" : "Project metadata"}
                  </p>
                </div>
              ))}
            </div>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold leading-tight text-white">
                Live Incidents
              </h2>
              <span className="font-mono text-xs text-[var(--ink-muted)]">bounty feed</span>
            </div>
            <div className="space-y-3">
              {incidents.map((incident) => (
                <button
                  key={incident.id}
                  onClick={() => setSelectedId(incident.id)}
                  className={`group flex w-full items-start gap-3 rounded-[1.1rem] border p-3 text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    selectedId === incident.id
                      ? "border-emerald-200/40 bg-emerald-200/[0.12] shadow-[0_0_24px_rgba(73,247,169,0.16),inset_0_1px_0_rgba(255,255,255,0.08)]"
                      : "border-white/7 bg-white/[0.025] hover:-translate-y-px hover:border-emerald-200/20 hover:bg-white/[0.06]"
                  }`}
                >
                  <SeverityRail severity={incident.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[0.72rem] text-emerald-200/82">
                        {incident.id}
                      </span>
                      <span className="font-mono text-[0.72rem] text-[var(--gold)]">
                        {incident.bounty}
                      </span>
                    </span>
                    <span className="mt-2 block font-display text-sm font-semibold text-white">
                      {incident.name}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">
                      {incident.project} - {incident.status}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </motion.aside>

        <motion.section
          initial={{ y: 34, opacity: 0, filter: "blur(12px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 1, ease: [0.32, 0.72, 0, 1], delay: 0.2 }}
          className="space-y-5"
        >
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div id="agent-core-panel" className="bezel min-h-[31rem] scroll-mt-6 rounded-[2.1rem] p-1.5">
              <div className="bezel-core relative h-full min-h-[31rem] overflow-hidden rounded-[1.7rem]">
                <div className="absolute inset-x-8 top-7 z-10 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-200/70">
                      agent core
                    </p>
                    <h2 className="mt-2 max-w-full font-display text-4xl font-semibold leading-[0.98] text-white drop-shadow-[0_2px_28px_rgba(0,0,0,0.9)] sm:text-[2.9rem] xl:text-[2.9rem]">
                      {selected.name}
                    </h2>
                  </div>
                  <div className="chip-glass glow-ring flex items-center gap-2 rounded-full px-4 py-2 font-mono text-sm text-emerald-100">
                    <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    Confidence {selected.confidence}%
                  </div>
                </div>
                <GradientIncidentField selected={selected} />
              </div>
            </div>

            <div className="bezel rounded-[1.85rem] p-1.5">
              <div className="bezel-core h-full rounded-[1.45rem] p-5">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-100/70">
                  escrow
                </p>
                <p className="iris-text mt-5 font-display text-5xl font-semibold tracking-tight">
                  {selected.bounty}
                </p>
                <div className="gold-line mt-5 h-px w-full" />
                <div className="mt-5 space-y-4 text-sm">
                  <div className="flex justify-between text-[var(--ink-muted)]">
                    <span>Status</span>
                    <span className="text-emerald-100">{selected.status}</span>
                  </div>
                  <div className="flex justify-between text-[var(--ink-muted)]">
                    <span>Severity</span>
                    <span className="text-rose-100">{selected.severity}</span>
                  </div>
                  <div className="flex justify-between text-[var(--ink-muted)]">
                    <span>Verifier</span>
                    <span className="text-cyan-100">Somnia Agent</span>
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <CommandButton
                    disabled={!selected.fixId}
                    onClick={() => {
                      if (selected.fixId) void bounty.actions.requestFixReview(selected.fixId);
                    }}
                  >
                    Verify Fix
                  </CommandButton>
                  <CommandButton onClick={() => setActivePanel("incident")}>Fund Bounty</CommandButton>
                </div>
              </div>
            </div>
          </div>

          <div className="bezel rounded-[1.85rem] p-1.5">
            <div className="bezel-core rounded-[1.45rem] p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-display text-xl font-semibold text-white">Autonomous loop</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Current handoff: {selected.proof} {"->"} payout gate
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {loop.map((step, index) => (
                    <motion.div
                      key={step}
                      initial={{ y: 18, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.72,
                        ease: [0.32, 0.72, 0, 1],
                        delay: 0.32 + index * 0.06,
                      }}
                      className={`rounded-full border px-4 py-2 text-center font-mono text-xs transition-all duration-700 ${
                        index < 4
                          ? "border-emerald-200/30 bg-emerald-200/[0.12] text-emerald-100 shadow-[0_0_16px_rgba(73,247,169,0.18)]"
                          : "border-white/8 bg-white/[0.025] text-[var(--ink-muted)]"
                      }`}
                    >
                      {step}
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.aside
          id="fix-review-panel"
          initial={{ x: 32, opacity: 0, filter: "blur(10px)" }}
          animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.95, ease: [0.32, 0.72, 0, 1], delay: 0.28 }}
          className="bezel rounded-[1.85rem] p-1.5"
        >
          <div className="bezel-core h-full rounded-[1.45rem] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-200/70">
                  fix review
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-white">
                  {selected.proof}
                </h2>
              </div>
              <span className="grid h-11 w-11 place-items-center rounded-full border border-emerald-200/16 bg-emerald-300/10 text-emerald-100">
                <IconMark className="h-5 w-5" />
              </span>
            </div>

            <div className="chip-glass mt-7 rounded-[1.25rem] p-4">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                agent verdict buffer
              </p>
              <p className="mt-3 text-sm leading-6 text-emerald-50/84">
                External call moved after balance mutation. Diff removes reentrant path and preserves
                withdrawal invariant across replayed exploit trace.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {[
                ["Static trace", "passed"],
                ["Exploit replay", "blocked"],
                ["Calldata match", "ready"],
                ["Payout gate", "waiting"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-[0.9rem] border border-white/7 bg-white/[0.025] px-4 py-3 text-sm transition-all duration-700 hover:-translate-y-px hover:border-emerald-200/20 hover:bg-white/[0.05]"
                >
                  <span className="text-[var(--ink-muted)]">{label}</span>
                  <span className="font-mono text-emerald-100">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <CommandButton onClick={() => setActivePanel("register")}>Register Project</CommandButton>
              <CommandButton onClick={() => setActivePanel("incident")}>Open Incident</CommandButton>
              <CommandButton onClick={() => setActivePanel("fix")}>Submit Fix</CommandButton>
              <CommandButton
                disabled={!selected.numericIncidentId || selected.status !== "Expired"}
                onClick={() => {
                  if (selected.numericIncidentId) void bounty.actions.reclaimExpired(selected.numericIncidentId);
                }}
              >
                Reclaim
              </CommandButton>
            </div>
          </div>
        </motion.aside>
      </section>
      <div className="relative z-10 mx-auto mt-5 flex max-w-[95rem] flex-col gap-2 text-xs text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
        <span>{wallet.status} - {bounty.status}</span>
        <span>
          {bounty.contractAddress ? (
            <a
              className="text-emerald-100 underline decoration-emerald-200/30 underline-offset-4"
              href={`${bounty.explorerBase}/address/${bounty.contractAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              Contract explorer
            </a>
          ) : (
            "Set NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS for live mode"
          )}
          {bounty.lastTx ? (
            <>
              {" "} | {" "}
              <a
                className="text-cyan-100 underline decoration-cyan-200/30 underline-offset-4"
                href={`${bounty.explorerBase}/tx/${bounty.lastTx}`}
                target="_blank"
                rel="noreferrer"
              >
                Last tx
              </a>
            </>
          ) : null}
        </span>
      </div>
      <ActionDrawer
        account={wallet.account}
        activePanel={activePanel}
        close={() => setActivePanel(null)}
        selected={selected}
        submit={bounty.actions}
      />
      </motion.div>
    </main>
  );
}
