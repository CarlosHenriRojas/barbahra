export type CampaignStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

export type ContactStatus =
  | "imported"
  | "queued"
  | "sent"
  | "error"
  | "replied"
  | "opt_out"
  | "no_whatsapp";

export type WhatsappStatus = "unchecked" | "checking" | "valid" | "invalid";
export type MessageType = "text" | "buttons";
export type MessageButtonType = "reply" | "url" | "call" | "copy";

export type MessageButton = {
  id: string;
  label: string;
  type: MessageButtonType;
  value?: string;
  isOptOut?: boolean;
};

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  consentBasis: string;
  createdAt: string;
  sendingConfig: CampaignSendingConfig;
};

export type CampaignSendingConfig = {
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  dailyStartTime: string;
  dailyEndTime: string;
};

export type ImportedRow = {
  id: string;
  raw: Record<string, string>;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  company?: string;
  customFields: Record<string, string>;
  status: ContactStatus;
  whatsappStatus: WhatsappStatus;
  errors: string[];
  duplicate: boolean;
};

export type MessageVariant = {
  id: string;
  label: string;
  body: string;
  messageType: MessageType;
  buttons: MessageButton[];
};

export type MessageJob = {
  id: string;
  campaignId: string;
  contactId: string;
  variantId: string;
  renderedMessage: string;
  messageType: MessageType;
  buttons: MessageButton[];
  status: ContactStatus;
  error?: string;
  sentAt?: string;
  scheduledAt?: string;
  delaySeconds?: number;
  whatsappCheckedAt?: string;
};

export type ColumnMapping = {
  nameColumn: string;
  phoneColumn: string;
  companyColumn?: string;
  customColumns: string[];
};

export type CampaignMetrics = {
  spreadsheetsImported: number;
  imported: number;
  contacts: number;
  queued: number;
  sent: number;
  error: number;
  replied: number;
  optOut: number;
  whatsappValid: number;
  whatsappInvalid: number;
  whatsappUnchecked: number;
};
