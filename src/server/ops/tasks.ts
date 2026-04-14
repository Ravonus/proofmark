import { eq } from "drizzle-orm";
import { runDocumentAutomationSweep } from "~/server/forensic/automation";
import { db } from "~/server/db";
import { billingPlans, contractDeployments, cryptoPlans, integrationConfigs } from "~/server/db/schema";
import { syncProofmarkSchemaBaseline } from "~/server/ops/database-schema-sync";

export const opsTaskNames = ["automation.sweep", "database.syncSchema", "deployment.readiness"] as const;

export type OpsTaskName = (typeof opsTaskNames)[number];

type OpsTaskResult = {
  result: unknown;
  summary: string;
  task: OpsTaskName;
};

function countConfigured(values: Record<string, boolean>) {
  return Object.values(values).filter(Boolean).length;
}

async function runDeploymentReadinessTask(): Promise<OpsTaskResult> {
  const [activeBillingPlanRows, activeCryptoPlanRows, activeContractRows, paymentIntegrations] = await Promise.all([
    db.query.billingPlans.findMany({
      columns: { id: true },
      where: eq(billingPlans.isActive, true),
    }),
    db.query.cryptoPlans.findMany({
      columns: { id: true },
      where: eq(cryptoPlans.isActive, true),
    }),
    db.query.contractDeployments.findMany({
      columns: { id: true },
      where: eq(contractDeployments.isActive, true),
    }),
    db.query.integrationConfigs.findMany({
      columns: { id: true, config: true },
      where: eq(integrationConfigs.kind, "PAYMENT"),
    }),
  ]);

  const stripeBillingIntegrations = paymentIntegrations.filter((integration) => {
    const config = integration.config as { provider?: string } | null;
    return config?.provider === "stripe_billing";
  }).length;

  const runtimeContractEnv = {
    BASE_ANCHOR_CONTRACT: Boolean(process.env.BASE_ANCHOR_CONTRACT),
    BASE_ANCHOR_PRIVATE_KEY: Boolean(process.env.BASE_ANCHOR_PRIVATE_KEY),
    BTC_TREASURY_ADDRESS: Boolean(process.env.BTC_TREASURY_ADDRESS),
    ETH_SUBSCRIPTION_CONTRACT: Boolean(process.env.ETH_SUBSCRIPTION_CONTRACT),
    NFT_CONTRACT: Boolean(process.env.NFT_CONTRACT),
    NFT_SIGNER_KEY: Boolean(process.env.NFT_SIGNER_KEY),
    OPEN_ANCHOR_CONTRACT: Boolean(process.env.OPEN_ANCHOR_CONTRACT),
  };

  const scriptDeploymentEnv = {
    ANCHOR_CONTRACT: Boolean(process.env.ANCHOR_CONTRACT),
    AUTHORIZED_SIGNER: Boolean(process.env.AUTHORIZED_SIGNER),
    BASE_SEPOLIA_RPC_URL: Boolean(process.env.BASE_SEPOLIA_RPC_URL),
    DEPLOY_PRIVATE_KEY: Boolean(process.env.DEPLOY_PRIVATE_KEY),
    ETH_SEPOLIA_RPC_URL: Boolean(process.env.ETH_SEPOLIA_RPC_URL),
    NFT_CONTRACT: Boolean(process.env.NFT_CONTRACT),
    OPEN_ANCHOR_CONTRACT: Boolean(process.env.OPEN_ANCHOR_CONTRACT),
    PRICE_ORACLE_CONTRACT: Boolean(process.env.PRICE_ORACLE_CONTRACT),
    SUBSCRIPTION_CONTRACT: Boolean(process.env.SUBSCRIPTION_CONTRACT),
    TREASURY_ADDRESS: Boolean(process.env.TREASURY_ADDRESS),
  };

  const authEnv = {
    AUTOMATION_SECRET: Boolean(process.env.AUTOMATION_SECRET),
    BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: Boolean(process.env.BETTER_AUTH_URL),
  };

  const result = {
    auth: authEnv,
    billing: {
      activeBillingPlans: activeBillingPlanRows.length,
      activeCryptoPlans: activeCryptoPlanRows.length,
      stripeBillingIntegrations,
    },
    contracts: {
      activeDeployments: activeContractRows.length,
      runtimeContractEnv,
      runtimeConfiguredCount: countConfigured(runtimeContractEnv),
      runtimeExpectedCount: Object.keys(runtimeContractEnv).length,
      scriptConfiguredCount: countConfigured(scriptDeploymentEnv),
      scriptDeploymentEnv,
      scriptExpectedCount: Object.keys(scriptDeploymentEnv).length,
    },
    generatedAt: new Date().toISOString(),
  };

  return {
    task: "deployment.readiness",
    summary: [
      `${result.contracts.activeDeployments} active contract deployments`,
      `${result.billing.activeBillingPlans} active billing plans`,
      `${result.billing.stripeBillingIntegrations} Stripe billing integrations`,
      `runtime env ${result.contracts.runtimeConfiguredCount}/${result.contracts.runtimeExpectedCount} set`,
    ].join(" · "),
    result,
  };
}

async function runDatabaseSyncTask(): Promise<OpsTaskResult> {
  const result = await syncProofmarkSchemaBaseline();

  return {
    task: "database.syncSchema",
    summary: `Ensured auth and billing schema baseline with ${result.appliedStatements.length} idempotent statements.`,
    result,
  };
}

export async function runOpsTask(task: OpsTaskName): Promise<OpsTaskResult> {
  switch (task) {
    case "automation.sweep": {
      const result = await runDocumentAutomationSweep();
      return {
        task,
        summary: `Scanned ${result.scanned} pending documents, expired ${result.expired}, reminded ${result.reminded}.`,
        result,
      };
    }
    case "database.syncSchema":
      return runDatabaseSyncTask();
    case "deployment.readiness":
      return runDeploymentReadinessTask();
  }
}
