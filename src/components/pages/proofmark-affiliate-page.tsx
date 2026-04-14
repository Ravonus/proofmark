"use client";

import {
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Layers3,
  Megaphone,
  Shield,
  Workflow,
} from "lucide-react";
import { FadeIn, GlassCard, StaggerContainer, StaggerItem, W3SLink } from "~/components/ui/motion";

const partnerAudience = [
  "Web3 communities and ecosystem operators introducing new tools to their members",
  "Agencies, growth teams, and legal ops consultants packaging Proofmark into client workflows",
  "Creators and educators teaching wallet-native product stacks to founders and operators",
  "Integrators building custom onboarding, embedded signing, or high-trust workflow products",
];

const partnerBenefits = [
  {
    icon: BadgeDollarSign,
    title: "Recurring revenue potential",
    description: "Pitch Proofmark as infrastructure, not a one-time code. The program is structured around durable operator accounts and repeat usage.",
  },
  {
    icon: Layers3,
    title: "Operator-grade assets",
    description: "Landing copy, positioning angles, demo flows, and product-specific narratives are easier to hand off when the affiliate surface is built into the app.",
  },
  {
    icon: Workflow,
    title: "Track the full journey",
    description: "Affiliates can map traffic to actual product actions: account creation, document launches, verification views, and deal-specific funnels.",
  },
  {
    icon: Bot,
    title: "AI-assisted testing",
    description: "Partner pages can evolve with message testing, niche positioning, and conversion reviews instead of staying frozen after launch.",
  },
];

const payoutFlow = [
  {
    title: "Share a Proofmark-specific funnel.",
    description: "Send visitors to a dedicated landing experience that explains why multi-chain signing and forensic proof matter for their use case.",
  },
  {
    title: "Track product-qualified activity.",
    description: "Measure serious intent using document creation, verification, operator sign-in, and downstream workspace actions instead of click volume alone.",
  },
  {
    title: "Scale from warm intros to repeatable channels.",
    description: "As the program matures, the same partner surface can support private referrals, niche landing pages, co-branded campaigns, and managed agencies.",
  },
];

export function ProofmarkAffiliatePage() {
  return (
    <div className="pb-20">
      <AffiliateHero />
      <AffiliateBenefitGrid />
      <AffiliateAudienceSection />
      <AffiliateFlowSection />
      <AffiliateClose />
    </div>
  );
}

function AffiliateHero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--border-subtle)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,212,255,0.14),transparent_30%),radial-gradient(circle_at_top_right,rgba(124,92,252,0.18),transparent_34%),linear-gradient(180deg,rgba(7,7,10,0.9),rgba(7,7,10,0.98))]" />

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <FadeIn className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border-accent)] bg-[var(--accent-subtle)] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
              <Megaphone className="h-3 w-3" />
              Proofmark affiliate program
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              A partner page built for people selling trust, not shallow clicks.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-secondary sm:text-base">
              Proofmark’s affiliate motion is best for operators who can explain why wallet-native signing, audit visibility,
              and identity-aware workflows matter. This page gives that pitch a proper home.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <W3SLink href="/login" variant="primary" size="md">
                Get partner access
                <ArrowRight className="h-4 w-4" />
              </W3SLink>
              <W3SLink href="/" variant="accent-outline" size="md">
                View product story
              </W3SLink>
            </div>
          </FadeIn>

          <FadeIn delay={0.08}>
            <GlassCard className="space-y-4 p-5" hover={false}>
              <AffiliateMetric
                icon={BarChart3}
                label="Best-fit motion"
                value="Warm referrals, agency channels, ecosystem partnerships"
              />
              <AffiliateMetric
                icon={BriefcaseBusiness}
                label="Ideal buyer"
                value="Teams handling agreements where signature quality, compliance, or reputation materially matters"
              />
              <AffiliateMetric
                icon={Shield}
                label="Why partners win"
                value="The pitch is differentiated. Proofmark is easier to explain than a generic e-sign clone."
              />
            </GlassCard>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

function AffiliateMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-inset)] p-4">
      <div className="flex items-center gap-2 text-[var(--accent)]">
        <Icon className="h-4 w-4" />
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">{label}</p>
      </div>
      <p className="mt-3 text-sm leading-6 text-primary">{value}</p>
    </div>
  );
}

function AffiliateBenefitGrid() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <FadeIn className="mb-8 max-w-2xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Program shape</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">This affiliate surface is designed to support serious operators and measurable product adoption.</h2>
      </FadeIn>

      <StaggerContainer className="grid gap-4 md:grid-cols-2">
        {partnerBenefits.map((benefit) => (
          <StaggerItem key={benefit.title}>
            <GlassCard className="h-full p-5" hover={false}>
              <div className="inline-flex rounded-sm border border-[var(--border-accent)] bg-[var(--accent-subtle)] p-2 text-[var(--accent)]">
                <benefit.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-base font-semibold tracking-tight">{benefit.title}</h3>
              <p className="mt-3 text-sm leading-6 text-secondary">{benefit.description}</p>
            </GlassCard>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}

function AffiliateAudienceSection() {
  return (
    <section className="border-y border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(14,14,18,0.82),rgba(7,7,10,0.96))]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <FadeIn>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent-2)]">Who this is for</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">The best Proofmark affiliates already have trusted distribution.</h2>
          <p className="mt-4 text-sm leading-7 text-secondary">
            The strongest partner channels already sit close to founders, operators, and compliance-conscious teams that need better signing infrastructure.
          </p>
        </FadeIn>

        <div className="grid gap-3 sm:grid-cols-2">
          {partnerAudience.map((item, index) => (
            <FadeIn key={item} delay={0.05 * index}>
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

function AffiliateFlowSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <FadeIn className="mb-8 max-w-2xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Rollout path</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">How the affiliate motion can scale from private intros to repeatable campaigns.</h2>
      </FadeIn>

      <div className="space-y-4">
        {payoutFlow.map((step, index) => (
          <FadeIn key={step.title} delay={0.05 * index}>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-accent)] bg-[var(--accent-subtle)] text-xs font-semibold text-[var(--accent)]">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-primary">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-secondary">{step.description}</p>
                </div>
              </div>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}

function AffiliateClose() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
      <FadeIn>
        <GlassCard className="overflow-hidden p-0" hover={false}>
          <div className="grid gap-6 bg-[linear-gradient(135deg,rgba(124,92,252,0.14),rgba(0,212,255,0.08))] px-6 py-8 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Next step</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Log in, test the product, and then use this affiliate page as the first partner funnel.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">
                The page is intentionally written to support ecosystem intros, agency referrals, and more hands-on partner motions instead of disposable coupon traffic.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <W3SLink href="/login" variant="primary" size="md">
                Open operator login
              </W3SLink>
              <W3SLink href="/new" variant="accent-outline" size="md">
                Test the product
              </W3SLink>
            </div>
          </div>
        </GlassCard>
      </FadeIn>
    </section>
  );
}
