import { createEvolutionAdapter } from "./evolution";
import { createUazapiAdapter } from "./uazapi";

type UazapiAdapter = ReturnType<typeof createUazapiAdapter>;
type SendTextInput = Parameters<UazapiAdapter["sendTextMessage"]>[0];
type SendButtonInput = Parameters<UazapiAdapter["sendButtonMessage"]>[0];
type CheckInput = Parameters<UazapiAdapter["checkWhatsappNumber"]>[0];

export type WhatsappProviderName = "uazapi" | "evolution";
export type WhatsappProviderConfig = {
  primary: WhatsappProviderName;
  enabled: Record<WhatsappProviderName, boolean>;
};

type ProviderResult<T> = {
  provider: WhatsappProviderName;
  data: T;
  fallbackReason?: string;
};

type ProviderAdapter = {
  isConfigured(): boolean;
  sendTextMessage(input: SendTextInput): Promise<unknown>;
  sendButtonMessage(input: SendButtonInput): Promise<unknown>;
  checkWhatsappNumber(input: CheckInput): Promise<{
    hasWhatsapp?: boolean;
    matchedPhone?: string;
    checkedCandidates: string[];
    raw: unknown;
  }>;
};

export const defaultWhatsappProviderConfig: WhatsappProviderConfig = {
  primary: "uazapi",
  enabled: { uazapi: true, evolution: true }
};

export function createWhatsappProvider(
  config: WhatsappProviderConfig = defaultWhatsappProviderConfig
) {
  const adapters: Record<WhatsappProviderName, ProviderAdapter> = {
    uazapi: createUazapiAdapter(),
    evolution: createEvolutionAdapter()
  };
  const order = providerOrder(config);

  async function withFallback<T>(operation: (adapter: ProviderAdapter) => Promise<T>) {
    const errors: string[] = [];

    for (const provider of order) {
      const adapter = adapters[provider];
      if (!adapter.isConfigured()) {
        errors.push(`${providerLabel(provider)} não está configurado`);
        continue;
      }

      try {
        return {
          provider,
          data: await operation(adapter),
          fallbackReason: errors.length ? errors.join("; ") : undefined
        } satisfies ProviderResult<T>;
      } catch (error) {
        errors.push(`${providerLabel(provider)} falhou: ${errorMessage(error)}`);
      }
    }

    throw new Error(errors.length ? errors.join("; ") : "Nenhum provedor de WhatsApp está ativo");
  }

  return {
    sendTextMessage(input: SendTextInput) {
      return withFallback((adapter) => adapter.sendTextMessage(input));
    },

    sendButtonMessage(input: SendButtonInput) {
      return withFallback((adapter) => adapter.sendButtonMessage(input));
    },

    async checkWhatsappNumber(input: CheckInput) {
      const errors: string[] = [];
      let inconclusive: ProviderResult<Awaited<ReturnType<ProviderAdapter["checkWhatsappNumber"]>>> | undefined;

      for (const provider of order) {
        const adapter = adapters[provider];
        if (!adapter.isConfigured()) {
          errors.push(`${providerLabel(provider)} não está configurado`);
          continue;
        }

        try {
          const data = await adapter.checkWhatsappNumber(input);
          const result = {
            provider,
            data,
            fallbackReason: errors.length ? errors.join("; ") : undefined
          } satisfies ProviderResult<typeof data>;
          if (data.hasWhatsapp !== undefined) return result;
          inconclusive = result;
          errors.push(`Verificação inconclusiva no ${providerLabel(provider)}`);
        } catch (error) {
          errors.push(`${providerLabel(provider)} falhou: ${errorMessage(error)}`);
        }
      }

      if (inconclusive) return inconclusive;
      throw new Error(errors.length ? errors.join("; ") : "Nenhum provedor de WhatsApp está ativo");
    }
  };
}

function providerOrder(config: WhatsappProviderConfig) {
  const secondary: WhatsappProviderName = config.primary === "uazapi" ? "evolution" : "uazapi";
  return [config.primary, secondary].filter((provider) => config.enabled[provider]);
}

function providerLabel(provider: WhatsappProviderName) {
  return provider === "uazapi" ? "Uazapi" : "Evolution";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
