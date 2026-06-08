import type { Campaign, Contact, MessageVariant } from "./types";
import { optOutButton } from "./buttons";

export const demoCampaign: Campaign = {
  id: "demo-campaign",
  name: "Upsell pós-compra",
  status: "draft",
  consentBasis: "Base própria de compradores com consentimento",
  createdAt: new Date().toISOString(),
  sendingConfig: {
    minIntervalSeconds: 45,
    maxIntervalSeconds: 120,
    dailyStartTime: "09:00",
    dailyEndTime: "18:00"
  }
};

export const demoContacts: Contact[] = [
  {
    id: "lead-1",
    name: "Mariana Alves",
    phone: "5511999991111",
    customFields: {
      produto_comprado: "Curso Instagram Lucrativo",
      upsell: "Mentoria Express"
    },
    status: "imported",
    whatsappStatus: "unchecked",
    errors: [],
    duplicate: false
  },
  {
    id: "lead-2",
    name: "Renato Lima",
    phone: "5521999992222",
    customFields: {
      produto_comprado: "E-book Tráfego Simples",
      upsell: "Comunidade VIP"
    },
    status: "imported",
    whatsappStatus: "unchecked",
    errors: [],
    duplicate: false
  },
  {
    id: "lead-3",
    name: "Camila Souza",
    phone: "5531999993333",
    customFields: {
      produto_comprado: "Aula Avançada",
      upsell: "Plano Premium"
    },
    status: "imported",
    whatsappStatus: "unchecked",
    errors: [],
    duplicate: false
  }
];

export const demoVariants: MessageVariant[] = [
  {
    id: "variant-1",
    label: "Upsell consultivo",
    body: "Olá, {{nome}}. Vi que você comprou {{produto_comprado}} e tenho uma condição especial para entrar no {{upsell}}.",
    messageType: "buttons",
    buttons: [
      { id: "know_more", label: "Quero saber mais", type: "reply" },
      { id: "talk_to_agent", label: "Falar com suporte", type: "reply" },
      optOutButton
    ]
  },
  {
    id: "variant-2",
    label: "Upsell direto",
    body: "Oi, {{nome}}. Posso te mandar os detalhes do {{upsell}} como próximo passo depois do {{produto_comprado}}?",
    messageType: "buttons",
    buttons: [
      { id: "yes", label: "Pode enviar", type: "reply" },
      optOutButton
    ]
  }
];
