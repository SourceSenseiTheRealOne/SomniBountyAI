"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { type Address } from "viem";
import { useSomniaWallet } from "@/hooks/use-somnia-wallet";
import { hashText, useSomniBounty, type UiProject } from "@/hooks/use-somnibounty";
import {
  projectMetadataSchema,
  type ProjectMetadataFormValues,
} from "@/lib/project-metadata";

type ProjectIpfsResponse = {
  ipfsUri: string;
  metadataJson: string;
};

const twitterUrl = "https://twitter.com/";
const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid EVM wallet address");

const registrationSchema = projectMetadataSchema.extend({
  agentPayoutWallet: addressSchema,
});

const bountySchema = z.object({
  critical: z.coerce
    .number()
    .min(0.05, "Critical bounty minimum is 0.05 STT")
    .max(1_000_000, "Value is too large"),
  high: z.coerce
    .number()
    .min(0.02, "High bounty minimum is 0.02 STT")
    .max(1_000_000, "Value is too large"),
  medium: z.coerce
    .number()
    .min(0.01, "Medium bounty minimum is 0.01 STT")
    .max(1_000_000, "Value is too large"),
});

type RegistrationValues = z.infer<typeof registrationSchema>;
type RegistrationInput = z.input<typeof registrationSchema>;
type BountyValues = z.infer<typeof bountySchema>;
type BountyInput = z.input<typeof bountySchema>;
type DashboardView = "overview" | "logs";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-xs text-rose-200">{message}</p>;
}

function MatrixLoader() {
  const columns = useMemo(
    () =>
      Array.from({ length: 34 }, (_, index) => ({
        id: index,
        left: `${(index / 34) * 100}%`,
        delay: (index % 9) * 0.18,
        duration: 2.2 + (index % 7) * 0.28,
        text: "01 SCAN VALID PAY STT ".repeat(4),
      })),
    [],
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-hidden bg-[#020604] text-emerald-100"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(12px)" }}
      transition={{ duration: 0.75, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(34,197,94,0.18),transparent_28rem),linear-gradient(180deg,rgba(6,20,12,0.2),rgba(0,0,0,0.92))]" />
      {columns.map((column) => (
        <motion.div
          key={column.id}
          className="absolute top-[-40%] w-5 break-all font-mono text-[0.65rem] leading-4 text-emerald-300/55"
          style={{ left: column.left }}
          animate={{ y: ["0vh", "150vh"] }}
          transition={{
            duration: column.duration,
            delay: column.delay,
            repeat: Infinity,
            ease: "linear",
          }}
          aria-hidden="true"
        >
          {column.text}
        </motion.div>
      ))}
      <div className="relative z-10 grid min-h-[100dvh] place-items-center px-6">
        <div className="text-center">
          <motion.div
            className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-emerald-200/20 bg-emerald-300/10 shadow-[0_0_80px_rgba(52,211,153,0.2)]"
            animate={{ scale: [1, 1.06, 1], rotate: [0, 2, -2, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: [0.32, 0.72, 0, 1] }}
          >
            <span className="font-mono text-3xl font-semibold">SB</span>
          </motion.div>
          <h1 className="mt-8 font-display text-4xl font-semibold text-white sm:text-6xl">
            SomniBounty AI
          </h1>
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.32em] text-emerald-100/70">
            Somnia agents initializing
          </p>
          <div className="mt-8 h-1.5 w-[min(28rem,80vw)] overflow-hidden rounded-full border border-emerald-200/15 bg-white/5">
            <motion.div
              className="h-full rounded-full bg-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.55)]"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 4, ease: [0.32, 0.72, 0, 1] }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Button({
  children,
  disabled,
  type = "button",
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-200/20 bg-emerald-300/12 px-5 text-sm font-medium text-emerald-50 transition hover:border-emerald-200/45 hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function ShellNav({
  activeView,
  setActiveView,
  onBounty,
}: {
  activeView: DashboardView;
  setActiveView: (view: DashboardView) => void;
  onBounty: () => void;
}) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-white/10 bg-black/34 px-4 py-3 backdrop-blur-2xl">
      <Link href="/" className="iris-text font-display text-base font-semibold">
        SomniBounty AI
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        {(["overview", "logs"] as DashboardView[]).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              activeView === view
                ? "bg-white text-black"
                : "border border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]"
            }`}
          >
            {view === "overview" ? "Overview" : "Logs"}
          </button>
        ))}
        <Link
          href="/bounties/paid"
          className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/72 transition hover:bg-white/[0.08]"
        >
          Paid History
        </Link>
        <a
          href={twitterUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-50"
        >
          Follow us on Twitter
        </a>
        <Button onClick={onBounty}>Set Up Bounty</Button>
      </div>
    </nav>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.035] p-4">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-white/45">
        {label}
      </p>
      <p className="mt-3 font-display text-3xl font-semibold text-emerald-100">{value}</p>
    </div>
  );
}

function RegistrationView({
  walletStatus,
  connectedAccount,
  connect,
  onSubmit,
  pending,
  error,
}: {
  walletStatus: string;
  connectedAccount: Address | null;
  connect: () => void;
  onSubmit: (values: RegistrationValues) => Promise<void>;
  pending: boolean;
  error: string;
}) {
  const form = useForm<RegistrationInput, unknown, RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      name: "",
      description: "",
      socialUrl: "",
      imageUrl: "",
      githubRepo: "",
      agentPayoutWallet: connectedAccount ?? "",
    },
  });

  useEffect(() => {
    if (connectedAccount && !form.getValues("agentPayoutWallet")) {
      form.setValue("agentPayoutWallet", connectedAccount, { shouldValidate: true });
    }
  }, [connectedAccount, form]);

  return (
    <section className="grid min-h-[calc(100dvh-2.5rem)] place-items-center px-4 py-10">
      <div className="w-full max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-emerald-200/70">
              register project
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold text-white sm:text-6xl">
              Publish a bounty target
            </h1>
          </div>
          <Button onClick={connect}>{connectedAccount ? walletStatus : "Connect Wallet"}</Button>
        </div>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="rounded-[1.5rem] border border-white/10 bg-black/32 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:p-7"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm text-white/72">Project name</span>
              <input
                {...form.register("name")}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors.name?.message} />
            </label>
            <label className="block">
              <span className="text-sm text-white/72">GitHub repo URL</span>
              <input
                {...form.register("githubRepo")}
                placeholder="https://github.com/org/repo"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors.githubRepo?.message} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-white/72">Description</span>
              <textarea
                {...form.register("description")}
                rows={4}
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors.description?.message} />
            </label>
            <label className="block">
              <span className="text-sm text-white/72">Social media URL</span>
              <input
                {...form.register("socialUrl")}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors.socialUrl?.message} />
            </label>
            <label className="block">
              <span className="text-sm text-white/72">Image URL</span>
              <input
                {...form.register("imageUrl")}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors.imageUrl?.message} />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-white/72">Agent payout wallet</span>
              <input
                {...form.register("agentPayoutWallet")}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors.agentPayoutWallet?.message} />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/50">{walletStatus}</p>
            <Button type="submit" disabled={pending}>
              {pending ? "Publishing..." : "Register Project"}
            </Button>
          </div>
          {error ? <p className="mt-4 text-sm text-rose-200">{error}</p> : null}
        </form>
      </div>
    </section>
  );
}

function Overview({
  projects,
  selectedProject,
  scanJobs,
  incidents,
  paidCount,
}: {
  projects: UiProject[];
  selectedProject?: UiProject;
  scanJobs: ReturnType<typeof useSomniBounty>["scanJobs"];
  incidents: ReturnType<typeof useSomniBounty>["incidents"];
  paidCount: number;
}) {
  const tierValues = selectedProject?.tiers ?? { critical: 0n, high: 0n, medium: 0n };
  const maxTier = Number(
    [tierValues.critical, tierValues.high, tierValues.medium].reduce(
      (max, value) => (value > max ? value : max),
      1n,
    ),
  );
  const tierChart = [
    ["Critical", tierValues.critical, "bg-rose-300"],
    ["High", tierValues.high, "bg-amber-300"],
    ["Medium", tierValues.medium, "bg-cyan-300"],
  ] as const;

  return (
    <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_22rem]">
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Projects" value={projects.length.toString()} />
          <Stat label="Scan jobs" value={scanJobs.length.toString()} />
          <Stat label="Open incidents" value={incidents.length.toString()} />
          <Stat label="Paid bounties" value={paidCount.toString()} />
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/28 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-100/70">
                selected project
              </p>
              <h2 className="mt-3 font-display text-2xl font-semibold text-white">
                {selectedProject?.name ?? "No project selected"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
                {selectedProject?.description ?? "Register a live project to start the agent flow."}
              </p>
            </div>
            {selectedProject?.githubRepo ? (
              <a
                href={selectedProject.githubRepo}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-50"
              >
                GitHub
              </a>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {tierChart.map(([label, value, color]) => (
              <div key={label} className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-white/70">{label}</p>
                  <p className="font-mono text-xs text-white/50">
                    {(Number(value) / 1e18).toFixed(3)} STT
                  </p>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${Math.max(4, (Number(value) / maxTier) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/28 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-100/70">
            agent jobs
          </p>
          <div className="mt-4 grid gap-3">
            {scanJobs.length > 0 ? (
              scanJobs.map((job) => (
                <div
                  key={job.id}
                  className="grid gap-3 rounded-xl border border-white/8 bg-white/[0.035] p-4 md:grid-cols-[8rem_1fr_10rem]"
                >
                  <p className="font-mono text-xs text-emerald-100">{job.id}</p>
                  <div>
                    <p className="text-sm font-medium text-white">{job.project}</p>
                    <p className="mt-1 truncate text-xs text-white/45">{job.result || job.resultHash}</p>
                  </div>
                  <p className="font-mono text-xs text-cyan-100">{job.status}</p>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-white/8 bg-white/[0.035] p-5 text-sm text-white/52">
                No live scan jobs yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <aside className="rounded-[1.5rem] border border-white/10 bg-black/28 p-5">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/45">flow</p>
        <div className="mt-5 grid gap-3">
          {[
            "Register Project",
            "Set Bounty Tiers",
            "Somnia Scan",
            "Second Agent Review",
            "Backend PR",
            "Verifier Callback",
            "Bounty Paid",
          ].map((step, index) => (
            <div key={step} className="flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full border border-emerald-200/20 bg-emerald-300/10 font-mono text-xs text-emerald-100">
                {index + 1}
              </span>
              <span className="text-sm text-white/70">{step}</span>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}

function LogsView({ logs }: { logs: ReturnType<typeof useSomniBounty>["agentLogs"] }) {
  return (
    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/28 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-100/70">
        agent logs
      </p>
      <div className="mt-5 grid gap-3">
        {logs.length > 0 ? (
          logs.map((log) => (
            <div
              key={log.id}
              className="grid gap-3 rounded-xl border border-white/8 bg-white/[0.035] p-4 md:grid-cols-[9rem_1fr_7rem]"
            >
              <p className="font-mono text-xs text-white/45">
                {log.scanJobId ? `JOB-${log.scanJobId}` : `PRJ-${log.projectId}`}
              </p>
              <div>
                <p className="text-sm font-medium text-white">{log.step}</p>
                <p className="mt-1 text-xs text-white/48">{log.detail}</p>
              </div>
              <p
                className={`font-mono text-xs ${
                  log.status === "failed"
                    ? "text-rose-200"
                    : log.status === "pending"
                      ? "text-amber-200"
                      : "text-emerald-100"
                }`}
              >
                {log.status}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-white/8 bg-white/[0.035] p-5 text-sm text-white/52">
            No live agent logs yet.
          </p>
        )}
      </div>
    </section>
  );
}

function BountyModal({
  project,
  close,
  onSubmit,
  pending,
  error,
}: {
  project?: UiProject;
  close: () => void;
  onSubmit: (values: BountyValues) => Promise<void>;
  pending: boolean;
  error: string;
}) {
  const form = useForm<BountyInput, unknown, BountyValues>({
    resolver: zodResolver(bountySchema),
    defaultValues: {
      critical: 0.05,
      high: 0.02,
      medium: 0.01,
    },
  });

  return (
    <motion.div
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 px-4 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.form
        onSubmit={form.handleSubmit(onSubmit)}
        className="w-full max-w-xl rounded-[1.5rem] border border-white/10 bg-[#07110f] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.4)]"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-100/70">
              bounty tiers
            </p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-white">
              {project ? project.name : "No project selected"}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70"
          >
            x
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {[
            ["critical", "Critical", "0.05 STT minimum"],
            ["high", "High", "0.02 STT minimum"],
            ["medium", "Medium", "0.01 STT minimum"],
          ].map(([name, label, hint]) => (
            <label key={name} className="block">
              <span className="flex items-center justify-between text-sm text-white/72">
                <span>{label}</span>
                <span className="font-mono text-xs text-white/40">{hint}</span>
              </span>
              <input
                type="number"
                step="0.001"
                {...form.register(name as keyof BountyValues)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-emerald-200/45"
              />
              <FieldError message={form.formState.errors[name as keyof BountyValues]?.message} />
            </label>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/50">Funding this transaction starts the Somnia scan.</p>
          <Button type="submit" disabled={!project || pending}>
            {pending ? "Funding..." : "Set Bounty"}
          </Button>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-200">{error}</p> : null}
      </motion.form>
    </motion.div>
  );
}

export function SecurityConsole() {
  const [booting, setBooting] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [bountyOpen, setBountyOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<bigint | null>(null);
  const wallet = useSomniaWallet();
  const bounty = useSomniBounty(wallet.walletClient, wallet.account);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 4_000);
    return () => window.clearTimeout(timer);
  }, []);

  const selectedProject =
    bounty.projects.find((project) => project.numericProjectId === selectedProjectId) ??
    bounty.projects[0];

  async function registerProject(values: RegistrationValues) {
    setError("");
    setPending(true);
    try {
      const metadataValues: ProjectMetadataFormValues = {
        name: values.name,
        description: values.description,
        socialUrl: values.socialUrl,
        imageUrl: values.imageUrl,
        githubRepo: values.githubRepo,
      };
      const response = await fetch("/api/ipfs/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadataValues),
      });
      const data = (await response.json()) as ProjectIpfsResponse & {
        error?: string;
        errors?: Record<string, string[]>;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Project metadata pin failed");
      }
      await bounty.actions.registerProject(
        values.name,
        values.description,
        values.socialUrl,
        values.imageUrl,
        values.githubRepo,
        hashText(data.metadataJson || data.ipfsUri),
        values.agentPayoutWallet as Address,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register project");
    } finally {
      setPending(false);
    }
  }

  async function setupBounty(values: BountyValues) {
    if (!selectedProject) return;
    setError("");
    setPending(true);
    try {
      await bounty.actions.setupBountyTiers(
        selectedProject.numericProjectId,
        values.critical.toString(),
        values.high.toString(),
        values.medium.toString(),
      );
      setBountyOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to set bounty");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="noise scanlines relative min-h-[100dvh] overflow-hidden bg-[#030706] text-foreground">
      <AnimatePresence>{booting ? <MatrixLoader /> : null}</AnimatePresence>
      <div className="aurora" aria-hidden="true" />

      {!booting && bounty.projects.length === 0 ? (
        <RegistrationView
          walletStatus={wallet.status}
          connectedAccount={wallet.account}
          connect={wallet.connect}
          onSubmit={registerProject}
          pending={pending}
          error={error}
        />
      ) : null}

      {!booting && bounty.projects.length > 0 ? (
        <div className="relative z-10 mx-auto max-w-[88rem] px-4 py-5 sm:px-6 lg:px-8">
          <ShellNav
            activeView={activeView}
            setActiveView={setActiveView}
            onBounty={() => setBountyOpen(true)}
          />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {bounty.projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.numericProjectId)}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    project.numericProjectId === selectedProject?.numericProjectId
                      ? "bg-emerald-200 text-black"
                      : "border border-white/10 bg-white/[0.04] text-white/68 hover:bg-white/[0.08]"
                  }`}
                >
                  {project.name}
                </button>
              ))}
            </div>
            <p className="text-sm text-white/50">{bounty.status}</p>
          </div>

          {activeView === "overview" ? (
            <Overview
              projects={bounty.projects}
              selectedProject={selectedProject}
              scanJobs={bounty.scanJobs}
              incidents={bounty.incidents}
              paidCount={bounty.paidBounties.length}
            />
          ) : (
            <LogsView logs={bounty.agentLogs} />
          )}
        </div>
      ) : null}

      <AnimatePresence>
        {bountyOpen ? (
          <BountyModal
            project={selectedProject}
            close={() => setBountyOpen(false)}
            onSubmit={setupBounty}
            pending={pending}
            error={error}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
