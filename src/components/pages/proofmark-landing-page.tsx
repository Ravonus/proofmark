"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  FileCheck2,
  Fingerprint,
  Link2,
  MailCheck,
  Network,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { FadeIn, GlassCard, StaggerContainer, StaggerItem, W3SLink } from "~/components/ui/motion";

const heroStats = [
  { label: "Supported networks", value: "ETH, Base, SOL, BTC" },
  { label: "Signing modes", value: "Wallet, email, OTP" },
  { label: "Proof surfaces", value: "Audit trail, replay, anchors" },
];

const featureCards = [
  {
    icon: Wallet,
    eyebrow: "Crypto-native signing",
    title: "Collect wallet signatures without forcing everyone through one chain.",
    description:
      "Proofmark lets teams route signatures through Ethereum, Base, Solana, and Bitcoin while keeping a single contract workflow.",
  },
  {
    icon: MailCheck,
    eyebrow: "Fallback identity",
    title: "Handle email-first signers when a wallet would slow the deal down.",
    description:
      "OTP flows, document access controls, and signer-specific verification keep the process usable for non-crypto recipients.",
  },
  {
    icon: Fingerprint,
    eyebrow: "Forensic proof",
    title: "Preserve behavioral evidence when trust matters more than a checkbox.",
    description:
      "Replay data, liveness signals, device fingerprints, and audit chains give operators a deeper record of how a signature happened.",
  },
  {
    icon: ShieldCheck,
    eyebrow: "Controlled delivery",
    title: "Turn every agreement into a gated experience instead of a loose PDF handoff.",
    description:
      "Sequential routing, post-sign reveal content, branded portals, and controlled access windows keep the signing surface intentional.",
  },
  {
    icon: Bot,
    eyebrow: "AI-assisted review",
    title: "Use AI to pressure-test suspicious behavior before it turns into a bad signature.",
    description:
      "Automation review signals and replay tooling let your team inspect high-risk flows without building a separate trust stack.",
  },
  {
    icon: Link2,
    eyebrow: "Embeddable workflows",
    title: "Drop Proofmark into your product without rebuilding your onboarding or alerts.",
    description:
      "Embedded signing, webhook hooks, BYO integrations, and customizable branding make the product usable for operators and end users.",
  },
];

const proofSteps = [
  {
    title: "Prepare the document once.",
    description: "Upload a PDF or start from a native template, then define fields, signer order, and delivery rules.",
  },
  {
    title: "Route each signer through the right trust path.",
    description: "Wallet auth, email OTP, and branded access steps let you match the flow to the risk profile of the agreement.",
  },
  {
    title: "Verify outcomes with durable evidence.",
    description: "Every session leaves behind an audit trail, replay context, and optional anchoring signals you can inspect later.",
  },
];

const useCases = [
  "Investor updates, token purchase agreements, and ecosystem NDAs",
  "Embedded signing for marketplaces, compliance portals, and agent-led apps",
  "High-trust approvals where teams need more than a timestamp and a checkbox",
  "Product launches where wallet-native users and email-only users need the same workflow",
];

export function ProofmarkLandingPage() {
  return (
    <div className="pb-20">
      <HeroSection />
      <FeatureSection />
      <ProofSection />
      <UseCaseSection />
      <ConversionSection />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--border-subtle)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,92,252,0.18),transparent_38%),radial-gradient(circle_at_top_right,rgba(0,212,255,0.16),transparent_34%),linear-gradient(180deg,rgba(7,7,10,0.88),rgba(7,7,10,0.98))]" />
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(124,92,252,0.75),transparent)]" />

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <FadeIn className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border-accent)] bg-[var(--accent-subtle)] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
              <Sparkles className="h-3 w-3" />
              Proofmark for high-trust signatures
            </div>

            <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-primary sm:text-5xl">
              Web3-native document signing with the evidence layer most teams skip.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-secondary sm:text-base">
              Proofmark combines multi-chain wallet signatures, email fallback, forensic replay, and embedded delivery
              so agreements can move fast without becoming a blind spot.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <W3SLink href="/new" variant="primary" size="md">
                Start a document
                <ArrowRight className="h-4 w-4" />
              </W3SLink>
              <W3SLink href="/login" variant="accent-outline" size="md">
                Operator login
              </W3SLink>
              <W3SLink href="/affiliates" variant="ghost" size="md" className="border border-[var(--border)]">
                Affiliate program
              </W3SLink>
            </div>

            <div className="mt-8 flex flex-wrap gap-3 text-[11px] text-muted">
              <HeroPill icon={Network} label="Multi-chain agreements" />
              <HeroPill icon={FileCheck2} label="Replay-ready proof packets" />
              <HeroPill icon={MailCheck} label="Email + wallet in one workflow" />
            </div>
          </FadeIn>

          <FadeIn delay={0.08}>
            <GlassCard className="relative overflow-hidden p-0" hover={false}>
              <div className="border-b border-[var(--border)] bg-[linear-gradient(135deg,rgba(124,92,252,0.14),rgba(0,212,255,0.08))] px-5 py-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
                  Trust surface
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight">One signing stack for crypto-native and mixed audiences.</h2>
              </div>

              <div className="space-y-4 p-5">
                {heroStats.map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-[var(--border)] bg-[var(--bg-inset)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted">{stat.label}</p>
                    <p className="mt-2 text-sm font-medium text-primary">{stat.value}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

function HeroPill({ icon: Icon, label }: { icon: typeof Wallet; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card-80)] px-3 py-1.5">
      <Icon className="h-3 w-3 text-[var(--accent)]" />
      {label}
    </span>
  );
}

function FeatureSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <FadeIn className="mb-8 max-w-2xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Why teams pick Proofmark</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Everything a serious signing product needs, with room for crypto-specific workflows.</h2>
      </FadeIn>

      <StaggerContainer className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {featureCards.map((feature) => (
          <StaggerItem key={feature.title}>
            <GlassCard className="h-full p-5" hover={false}>
              <div className="inline-flex rounded-sm border border-[var(--border-accent)] bg-[var(--accent-subtle)] p-2 text-[var(--accent)]">
                <feature.icon className="h-4 w-4" />
              </div>
              <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">{feature.eyebrow}</p>
              <h3 className="mt-2 text-base font-semibold tracking-tight">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-secondary">{feature.description}</p>
            </GlassCard>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}

function ProofSection() {
  return (
    <section className="border-y border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(14,14,18,0.82),rgba(7,7,10,0.96))]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
        <FadeIn>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent-2)]">How it works</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Move from draft to verified outcome without splitting trust across five tools.</h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-secondary">
            The product is built for operators who need a usable signer experience and an evidence trail they can defend later.
          </p>
        </FadeIn>

        <div className="space-y-4">
          {proofSteps.map((step, index) => (
            <FadeIn key={step.title} delay={0.06 * index}>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
                <div className="flex items-start gap-4">
                  <motion.span
                    initial={{ opacity: 0.8 }}
                    animate={{ opacity: 1 }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-accent)] bg-[var(--accent-subtle)] text-xs font-semibold text-[var(--accent)]"
                  >
                    0{index + 1}
                  </motion.span>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-secondary">{step.description}</p>
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function UseCaseSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <FadeIn>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Built for</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Proofmark works best when signature quality affects revenue, compliance, or trust.</h2>
        </FadeIn>

        <div className="grid gap-3 sm:grid-cols-2">
          {useCases.map((item, index) => (
            <FadeIn key={item} delay={0.04 * index}>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm leading-6 text-secondary">
                {item}
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function ConversionSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
      <FadeIn>
        <GlassCard className="overflow-hidden p-0" hover={false}>
          <div className="grid gap-6 bg-[linear-gradient(135deg,rgba(124,92,252,0.14),rgba(0,212,255,0.08))] px-6 py-8 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Ready to test</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Use the live Proofmark app to create, sign, verify, and inspect flows right away.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">
                Start with the document creator, then move into dashboard and verification views once you want to inspect the full operator flow.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 lg:justify-end">
              <W3SLink href="/new" variant="primary" size="md">
                Open creator
              </W3SLink>
              <W3SLink href="/verify" variant="accent-outline" size="md">
                View verification
              </W3SLink>
            </div>
          </div>
        </GlassCard>
      </FadeIn>
    </section>
  );
}
