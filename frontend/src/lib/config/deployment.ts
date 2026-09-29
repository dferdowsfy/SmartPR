// ============================================================================
// Deployment configuration — SmartPR Standard vs SmartPR Enterprise.
//
// One typed, validated description of which infrastructure a deployment uses.
// Pure: reads only the env object passed in, performs no I/O, and has no side
// effects. Nothing imports this module yet — later reviewed PRs route the
// database, storage, auth and model layers through it.
//
// With no variables set, the result is exactly today's Standard deployment
// (Supabase database/storage/auth, direct model access). Standard never needs
// a new variable.
//
// Enterprise mode fails closed: every provider must be named explicitly, and
// CUSTOMER_ID is required. It never silently falls back to Supabase or to
// direct vendor model access.
//
// No customer, tenant, subscription, region or model identifiers belong here;
// those live in deployment configuration / IaC.
// ============================================================================

export const DEPLOYMENT_MODES = ["standard", "enterprise"] as const;
export const CLOUD_PROVIDERS = ["azure"] as const;
export const DATABASE_PROVIDERS = ["supabase", "azure-postgres"] as const;
export const STORAGE_PROVIDERS = ["supabase", "azure-blob"] as const;
export const AUTH_PROVIDERS = ["supabase", "entra"] as const;
export const MODEL_GATEWAYS = ["direct", "azure-foundry"] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number];
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];
export type ModelGateway = (typeof MODEL_GATEWAYS)[number];

export interface DeploymentConfig {
  mode: DeploymentMode;
  /** Required in enterprise mode; null in Standard (multi-tenant). */
  customerId: string | null;
  /** Null in Standard (current hosting); required in enterprise mode. */
  cloudProvider: CloudProvider | null;
  databaseProvider: DatabaseProvider;
  storageProvider: StorageProvider;
  authProvider: AuthProvider;
  modelGateway: ModelGateway;
}

export class DeploymentConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid deployment configuration: ${problems.join("; ")}`);
    this.name = "DeploymentConfigError";
  }
}

export const STANDARD_DEFAULTS: Readonly<DeploymentConfig> = Object.freeze({
  mode: "standard",
  customerId: null,
  cloudProvider: null,
  databaseProvider: "supabase",
  storageProvider: "supabase",
  authProvider: "supabase",
  modelGateway: "direct",
});

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parseEnum<T extends string>(
  env: Env,
  name: string,
  allowed: readonly T[],
  problems: string[]
): T | undefined {
  const raw = read(env, name);
  if (raw === undefined) return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  problems.push(`${name} must be one of ${allowed.join(" | ")} (got "${raw}")`);
  return undefined;
}

const CUSTOMER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function loadDeploymentConfig(env: Env = process.env): Readonly<DeploymentConfig> {
  const problems: string[] = [];

  const mode = parseEnum(env, "DEPLOYMENT_MODE", DEPLOYMENT_MODES, problems) ?? "standard";
  const cloudProvider = parseEnum(env, "CLOUD_PROVIDER", CLOUD_PROVIDERS, problems);
  const databaseProvider = parseEnum(env, "DATABASE_PROVIDER", DATABASE_PROVIDERS, problems);
  const storageProvider = parseEnum(env, "STORAGE_PROVIDER", STORAGE_PROVIDERS, problems);
  const authProvider = parseEnum(env, "AUTH_PROVIDER", AUTH_PROVIDERS, problems);
  const modelGateway = parseEnum(env, "MODEL_GATEWAY", MODEL_GATEWAYS, problems);
  const customerId = read(env, "CUSTOMER_ID");

  if (customerId !== undefined && !CUSTOMER_ID_PATTERN.test(customerId)) {
    problems.push("CUSTOMER_ID must be a lowercase slug (a-z, 0-9, '-'; 2–63 chars)");
  }

  if (mode === "standard") {
    if (customerId !== undefined) {
      problems.push("CUSTOMER_ID is only valid when DEPLOYMENT_MODE=enterprise");
    }
    if (problems.length) throw new DeploymentConfigError(problems);
    return Object.freeze({
      mode,
      customerId: null,
      cloudProvider: cloudProvider ?? null,
      databaseProvider: databaseProvider ?? STANDARD_DEFAULTS.databaseProvider,
      storageProvider: storageProvider ?? STANDARD_DEFAULTS.storageProvider,
      authProvider: authProvider ?? STANDARD_DEFAULTS.authProvider,
      modelGateway: modelGateway ?? STANDARD_DEFAULTS.modelGateway,
    });
  }

  // Enterprise: nothing may be inferred.
  const required: Array<[string, unknown]> = [
    ["CUSTOMER_ID", customerId],
    ["CLOUD_PROVIDER", cloudProvider],
    ["DATABASE_PROVIDER", databaseProvider],
    ["STORAGE_PROVIDER", storageProvider],
    ["AUTH_PROVIDER", authProvider],
    ["MODEL_GATEWAY", modelGateway],
  ];
  for (const [name, value] of required) {
    if (value === undefined && !problems.some((p) => p.startsWith(name))) {
      problems.push(`${name} is required when DEPLOYMENT_MODE=enterprise`);
    }
  }
  if (problems.length) throw new DeploymentConfigError(problems);

  return Object.freeze({
    mode,
    customerId: customerId!,
    cloudProvider: cloudProvider!,
    databaseProvider: databaseProvider!,
    storageProvider: storageProvider!,
    authProvider: authProvider!,
    modelGateway: modelGateway!,
  });
}
