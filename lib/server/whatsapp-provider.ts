import { createEvolutionAdapter } from "./evolution";
import { createUazapiAdapter } from "./uazapi";

type SendTextInput = Parameters<ReturnType<typeof createUazapiAdapter>["sendTextMessage"]>[0];
type SendButtonInput = Parameters<ReturnType<typeof createUazapiAdapter>["sendButtonMessage"]>[0];
type CheckInput = Parameters<ReturnType<typeof createUazapiAdapter>["checkWhatsappNumber"]>[0];

export type WhatsappProviderName = "uazapi" | "evolution";

type ProviderResult<T> = {
  provider: WhatsappProviderName;
  data: T;
  fallbackReason?: string;
};

export function createWhatsappProvider() {
  const uazapi = createUazapiAdapter();
  const evolution = createEvolutionAdapter();

  async function withFallback<T>(operation: {
    uazapi: () => Promise<T>;
    evolution: () => Promise<T>;
  }): Promise<ProviderResult<T>> {
    try {
      return { provider: "uazapi" as const, data: await operation.uazapi() };
    } catch (primaryError) {
      if (!evolution.isConfigured()) throw primaryError;

      try {
        return {
          provider: "evolution" as const,
          data: await operation.evolution(),
          fallbackReason: errorMessage(primaryError)
        };
      } catch (fallbackError) {
        throw new Error(
          `Uazapi falhou: ${errorMessage(primaryError)}; Evolution falhou: ${errorMessage(fallbackError)}`
        );
      }
    }
  }

  return {
    sendTextMessage(input: SendTextInput) {
      return withFallback({
        uazapi: () => uazapi.sendTextMessage(input),
        evolution: () => evolution.sendTextMessage(input)
      });
    },

    sendButtonMessage(input: SendButtonInput) {
      return withFallback({
        uazapi: () => uazapi.sendButtonMessage(input),
        evolution: () => evolution.sendButtonMessage(input)
      });
    },

    async checkWhatsappNumber(input: CheckInput) {
      try {
        const data = await uazapi.checkWhatsappNumber(input);
        if (data.hasWhatsapp !== undefined || !evolution.isConfigured()) {
          return { provider: "uazapi" as const, data };
        }
        const fallback = await evolution.checkWhatsappNumber(input);
        return {
          provider: "evolution" as const,
          data: fallback,
          fallbackReason: "Verificação inconclusiva na Uazapi"
        };
      } catch (primaryError) {
        if (!evolution.isConfigured()) throw primaryError;
        try {
          return {
            provider: "evolution" as const,
            data: await evolution.checkWhatsappNumber(input),
            fallbackReason: errorMessage(primaryError)
          };
        } catch (fallbackError) {
          throw new Error(
            `Uazapi falhou: ${errorMessage(primaryError)}; Evolution falhou: ${errorMessage(fallbackError)}`
          );
        }
      }
    }
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
