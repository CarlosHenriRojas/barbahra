"use client";

import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Trash2,
  FileSpreadsheet,
  Gauge,
  LogIn,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Square,
  Upload,
  UserCheck,
  UserX,
  LogOut
} from "lucide-react";
import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { demoVariants } from "@/lib/demo-data";
import { ensureOptOutButton, optOutButton } from "@/lib/buttons";
import {
  buildCampaignQueue,
  calculateMetrics,
  normalizeSendingConfig
} from "@/lib/queue";
import { guessColumn, mapRowsToContacts, parseSpreadsheet } from "@/lib/spreadsheet";
import { renderMessage } from "@/lib/message";
import type {
  Campaign,
  ColumnMapping,
  Contact,
  CampaignSendingConfig,
  ImportedRow,
  MessageButton,
  MessageJob,
  SystemLogEntry,
  MessageVariant
} from "@/lib/types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { verifyContactsForQueueWithProvider } from "@/lib/whatsapp";

type View = "home" | "campaigns" | "import" | "messages" | "queue" | "logs";

type SavedCampaignSummary = Campaign;

type CampaignSnapshot = {
  campaign: Campaign;
  contacts: Contact[];
  variants: MessageVariant[];
  jobs: MessageJob[];
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  ready: "Pronta",
  running: "Rodando",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
  imported: "Importado",
  queued: "Na fila",
  sent: "Enviado",
  error: "Erro",
  replied: "Respondido",
  opt_out: "Opt-out",
  no_whatsapp: "Sem WhatsApp",
  webhook: "Webhook",
  campaign: "Campanha",
  worker: "Worker"
};

const whatsappLabels: Record<string, string> = {
  unchecked: "Não verificado",
  checking: "Verificando",
  valid: "Com WhatsApp",
  invalid: "Sem WhatsApp"
};

export function Dashboard() {
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [activeView, setActiveView] = useState<View>("campaigns");
  const [campaign, setCampaign] = useState<Campaign>(() => createEmptyCampaign());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [variants, setVariants] = useState<MessageVariant[]>([]);
  const [jobs, setJobs] = useState<MessageJob[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    nameColumn: "",
    phoneColumn: "",
    companyColumn: "",
    customColumns: []
  });
  const [importFileName, setImportFileName] = useState("");
  const [optedOutPhones, setOptedOutPhones] = useState<Set<string>>(new Set());
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [verifyingWhatsapp, setVerifyingWhatsapp] = useState(false);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaignSummary[]>([]);
  const [loadingSavedCampaigns, setLoadingSavedCampaigns] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState("");
  const [campaignDetailsOpen, setCampaignDetailsOpen] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const supabaseAuth = useMemo(() => createBrowserSupabaseClient(), []);

  const metrics = useMemo(() => calculateMetrics(contacts, jobs), [contacts, jobs]);
  const validContacts = contacts.filter(
    (contact) =>
      contact.errors.length === 0 &&
      !contact.duplicate &&
      contact.status !== "opt_out" &&
      contact.status !== "no_whatsapp"
  );
  const readyToApprove =
    validContacts.length > 0 && variants.length > 0 && campaign.status === "draft";

  useEffect(() => {
    if (!supabaseAuth) {
      setAuthReady(true);
      setBootstrapping(false);
      setPersistenceStatus("Supabase não está configurado. Configure URL e anon key para entrar.");
      return;
    }

    let mounted = true;

    supabaseAuth.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSignedIn(Boolean(data.session));
      setUserEmail(data.session?.user.email ?? "");
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabaseAuth.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      setUserEmail(session?.user.email ?? "");
      if (!session) {
        resetCurrentCampaign();
        setSavedCampaigns([]);
        setJobs([]);
        setSystemLogs([]);
        setOptedOutPhones(new Set());
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabaseAuth]);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!supabaseAuth) {
        throw new Error("Supabase não está configurado.");
      }

      const session = await supabaseAuth.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        throw new Error("Sessão expirada. Entre novamente.");
      }

      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);

      return fetch(input, {
        ...init,
        headers
      });
    },
    [supabaseAuth]
  );

  function setUrlState(view: View, campaignId = campaign.id) {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    if (isUuid(campaignId)) {
      params.set("campaign", campaignId);
    } else {
      params.delete("campaign");
    }

    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  function navigateTo(view: View) {
    setActiveView(view);
    setUrlState(view);
  }

  function readUrlState() {
    if (typeof window === "undefined") return { view: "campaigns" as View, campaignId: "" };

    const params = new URLSearchParams(window.location.search);
    const view = parseView(params.get("view"));
    return {
      view,
      campaignId: params.get("campaign") ?? ""
    };
  }

  const refreshSavedCampaigns = useCallback(async () => {
    setLoadingSavedCampaigns(true);
    try {
      const response = await authFetch("/api/campaigns");
      const data = (await response.json()) as {
        ok?: boolean;
        campaigns?: SavedCampaignSummary[];
        error?: string;
      };

      if (response.ok && data.campaigns) {
        setSavedCampaigns(data.campaigns);
        setPersistenceStatus(data.campaigns.length ? "Campanhas carregadas do Supabase." : "");
        return;
      }

      setPersistenceStatus(data.error ?? "Não foi possível carregar campanhas salvas.");
    } catch {
      setPersistenceStatus("Não foi possível carregar campanhas salvas agora.");
    } finally {
      setLoadingSavedCampaigns(false);
    }
  }, [authFetch]);

  const refreshGlobalOptOuts = useCallback(async () => {
    try {
      const response = await authFetch("/api/opt-outs");
      const data = (await response.json()) as {
        ok?: boolean;
        optOuts?: Array<{ phone: string }>;
        error?: string;
      };

      if (response.ok && data.optOuts) {
        const phones = new Set(data.optOuts.map((optOut) => String(optOut.phone)));
        setOptedOutPhones(phones);
        setContacts((current) => applyOptOutBlocklist(current, phones));
        return phones;
      }

      setPersistenceStatus(data.error ?? "Não foi possível carregar opt-outs globais.");
    } catch {
      setPersistenceStatus("Não foi possível carregar opt-outs globais agora.");
    }

    return new Set<string>();
  }, [authFetch]);

  const refreshSystemLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const response = await authFetch("/api/logs");
      const data = (await response.json()) as {
        ok?: boolean;
        logs?: SystemLogEntry[];
        error?: string;
      };

      if (response.ok && data.logs) {
        setSystemLogs(data.logs);
        return;
      }

      setPersistenceStatus(data.error ?? "Não foi possível carregar logs.");
    } catch {
      setPersistenceStatus("Não foi possível carregar logs agora.");
    } finally {
      setLoadingLogs(false);
    }
  }, [authFetch]);

  const refreshOpenCampaign = useCallback(async () => {
    if (!isUuid(campaign.id)) return;

    try {
      const response = await authFetch(`/api/campaigns/${campaign.id}`);
      if (!response.ok) return;

      const data = (await response.json()) as CampaignSnapshot & { ok?: boolean };
      if (!data.campaign) return;

      // Lightweight live refresh: only status-bearing data, so it never clobbers
      // in-progress edits (variants, mapping) or the current view.
      setCampaign(data.campaign);
      setContacts(applyOptOutBlocklist(data.contacts ?? [], optedOutPhones));
      setJobs(data.jobs ?? []);
    } catch {
      // Silent: a failed background refresh shouldn't disrupt the operator.
    }
  }, [authFetch, campaign.id, optedOutPhones]);

  useEffect(() => {
    if (!signedIn) {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;

    async function bootstrapFromUrl() {
      setBootstrapping(true);
      const initialState = readUrlState();
      setActiveView(initialState.view);

      try {
        const response = await authFetch("/api/campaigns");
        const data = (await response.json()) as {
          ok?: boolean;
          campaigns?: SavedCampaignSummary[];
          error?: string;
        };

        if (cancelled) return;

        if (response.ok && data.campaigns) {
          setSavedCampaigns(data.campaigns);
          setPersistenceStatus(data.campaigns.length ? "Campanhas carregadas do Supabase." : "");
          const blockedPhones = await refreshGlobalOptOuts();

          if (isUuid(initialState.campaignId)) {
            await loadCampaignSnapshot(initialState.campaignId, initialState.view, false, blockedPhones);
          } else {
            resetCurrentCampaign();
            setUrlState(initialState.view, "");
          }
          return;
        }

        resetCurrentCampaign();
        setPersistenceStatus(
          data.error ?? "Não foi possível carregar campanhas salvas."
        );
      } catch {
        resetCurrentCampaign();
        setPersistenceStatus("Não foi possível carregar campanhas salvas agora.");
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }

    void bootstrapFromUrl();

    return () => {
      cancelled = true;
    };
    // The bootstrap should run on auth changes; the local helpers intentionally read current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, refreshGlobalOptOuts, signedIn]);

  useEffect(() => {
    if (!signedIn || activeView !== "logs") return;

    void refreshSystemLogs();
    const timer = window.setInterval(() => {
      void refreshSystemLogs();
    }, 8000);

    return () => window.clearInterval(timer);
  }, [activeView, refreshSystemLogs, signedIn]);

  // Keep the queue and home dashboard in sync with the backend worker while a
  // campaign is running, so statuses move from "Na fila" to "Enviado" live.
  useEffect(() => {
    if (!signedIn) return;
    if (activeView !== "queue" && activeView !== "home") return;
    if (!isUuid(campaign.id) || campaign.status !== "running") return;

    const timer = window.setInterval(() => {
      void refreshOpenCampaign();
    }, 6000);

    return () => window.clearInterval(timer);
  }, [activeView, campaign.id, campaign.status, refreshOpenCampaign, signedIn]);

  async function loadCampaignSnapshot(
    campaignId: string,
    nextView: View = "campaigns",
    syncUrl = true,
    blocklist = optedOutPhones
  ) {
    const response = await authFetch(`/api/campaigns/${campaignId}`);
    const data = (await response.json()) as CampaignSnapshot & { ok?: boolean; error?: string };

    if (!response.ok || !data.campaign) {
      setPersistenceStatus(data.error ?? "Não foi possível abrir a campanha salva.");
      return;
    }

    setCampaign(data.campaign);
    setContacts(applyOptOutBlocklist(data.contacts, blocklist));
    setVariants(data.variants.length ? data.variants : createDefaultVariants());
    setJobs(data.jobs);
    setHeaders([]);
    setRows([]);
    setMapping({
      nameColumn: "",
      phoneColumn: "",
      companyColumn: "",
      customColumns: []
    });
    setImportFileName("Campanha salva no Supabase");
    setPersistenceStatus("Campanha carregada do Supabase.");
    setCampaignDetailsOpen(true);
    setActiveView(nextView);
    if (syncUrl) setUrlState(nextView, data.campaign.id);
  }

  function resetCurrentCampaign() {
    setCampaign(createEmptyCampaign());
    setContacts([]);
    setVariants([]);
    setJobs([]);
    setHeaders([]);
    setRows([]);
    setMapping({
      nameColumn: "",
      phoneColumn: "",
      companyColumn: "",
      customColumns: []
    });
    setImportFileName("");
    setCampaignDetailsOpen(false);
  }

  async function saveCurrentCampaign() {
    if (!isUuid(campaign.id)) {
      setPersistenceStatus("Campanhas novas são salvas ao iniciar a fila pela primeira vez.");
      return;
    }

    setSavingCampaign(true);
    try {
      const response = await authFetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          campaign,
          variants
        })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        setPersistenceStatus(data.error ?? "Não foi possível salvar a campanha.");
        return;
      }

      setPersistenceStatus("Alterações salvas no Supabase.");
      setSavedCampaigns((current) =>
        current.map((savedCampaign) =>
          savedCampaign.id === campaign.id ? { ...savedCampaign, ...campaign } : savedCampaign
        )
      );
    } catch {
      setPersistenceStatus("Não foi possível salvar a campanha agora.");
    } finally {
      setSavingCampaign(false);
    }
  }

  async function createNewCampaign() {
    const draftCampaign = createDraftCampaign();
    const draftVariants = createDefaultVariants();

    try {
      const response = await authFetch("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          campaign: draftCampaign,
          variants: draftVariants
        })
      });
      const data = (await response.json()) as {
        ok?: boolean;
        campaign?: Campaign;
        campaignId?: string;
        error?: string;
      };

      if (!response.ok || !data.campaign) {
        setPersistenceStatus(data.error ?? "Não foi possível criar a campanha.");
        return;
      }

      setCampaign(data.campaign);
      setContacts([]);
      setVariants(draftVariants);
      setJobs([]);
      setHeaders([]);
      setRows([]);
      setImportFileName("");
      setCampaignDetailsOpen(true);
      setPersistenceStatus("Campanha rascunho criada no Supabase.");
      setActiveView("campaigns");
      setUrlState("campaigns", data.campaign.id);
      await refreshSavedCampaigns();
      await loadCampaignSnapshot(data.campaign.id, "campaigns");
    } catch {
      setPersistenceStatus("Não foi possível criar a campanha agora.");
    }
  }

  async function deleteCampaign(campaignId: string) {
    const savedCampaign = savedCampaigns.find((candidate) => candidate.id === campaignId);
    const confirmed = window.confirm(
      `Excluir a campanha "${savedCampaign?.name ?? "selecionada"}" e todos os dados vinculados?`
    );
    if (!confirmed) return;

    try {
      const response = await authFetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE"
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        setPersistenceStatus(data.error ?? "Não foi possível excluir a campanha.");
        return;
      }

      setPersistenceStatus("Campanha excluída.");
      await refreshSavedCampaigns();
      if (campaign.id === campaignId) {
        resetCurrentCampaign();
        setActiveView("campaigns");
        setUrlState("campaigns", "");
      }
    } catch {
      setPersistenceStatus("Não foi possível excluir a campanha agora.");
    }
  }

  async function deleteContact(contactId: string) {
    const contact = contacts.find((candidate) => candidate.id === contactId);
    const confirmed = window.confirm(`Excluir o contato "${contact?.name ?? "selecionado"}"?`);
    if (!confirmed) return;

    if (!isUuid(campaign.id) || !isUuid(contactId)) {
      setContacts((current) => current.filter((candidate) => candidate.id !== contactId));
      setJobs((current) => current.filter((job) => job.contactId !== contactId));
      return;
    }

    try {
      const response = await authFetch(`/api/campaigns/${campaign.id}/contacts/${contactId}`, {
        method: "DELETE"
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        setPersistenceStatus(data.error ?? "Não foi possível excluir o contato.");
        return;
      }

      setPersistenceStatus("Contato excluído da campanha.");
      await loadCampaignSnapshot(campaign.id, activeView);
    } catch {
      setPersistenceStatus("Não foi possível excluir o contato agora.");
    }
  }

  function updateSendingConfig(patch: Partial<CampaignSendingConfig>) {
    setCampaign((current) => ({
      ...current,
      status: isUuid(current.id) ? current.status : "draft",
      sendingConfig: normalizeSendingConfig({
        ...current.sendingConfig,
        ...patch
      })
    }));
    if (!isUuid(campaign.id)) setJobs([]);
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isUuid(campaign.id)) {
      setPersistenceStatus("Crie ou abra uma campanha antes de importar contatos.");
      event.target.value = "";
      return;
    }

    const parsed = await parseSpreadsheet(file);
    const guessedName = guessColumn(parsed.headers, ["nome", "name", "cliente", "lead"]);
    const guessedPhone = guessColumn(parsed.headers, ["telefone", "phone", "celular", "whatsapp"]);
    const nextMapping = {
      nameColumn: guessedName,
      phoneColumn: guessedPhone,
      companyColumn: "",
      customColumns: parsed.headers.filter(
        (header) => ![guessedName, guessedPhone].includes(header)
      )
    };

    setImportFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(nextMapping);
    const mappedContacts = applyOptOutBlocklist(
      mapRowsToContacts(parsed.rows, nextMapping),
      optedOutPhones
    );

    setContacts(mappedContacts);
    setJobs([]);
    setCampaign((current) => ({ ...current, status: "draft" }));
    setActiveView("import");
    setUrlState("import", campaign.id);

    try {
      const response = await authFetch(`/api/campaigns/${campaign.id}/imports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileName: file.name,
          contacts: mappedContacts
        })
      });
      const data = (await response.json()) as {
        ok?: boolean;
        importedCount?: number;
        skippedDuplicatesCount?: number;
        blockedOptOutCount?: number;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        setPersistenceStatus(data.error ?? "Não foi possível salvar a importação.");
        return;
      }

      setPersistenceStatus(
        `Importação salva: ${data.importedCount ?? 0} contato(s), ${
          data.skippedDuplicatesCount ?? 0
        } duplicado(s) ignorado(s), ${data.blockedOptOutCount ?? 0} opt-out(s) bloqueado(s).`
      );
      await loadCampaignSnapshot(campaign.id, "import");
    } catch {
      setPersistenceStatus("Não foi possível salvar a importação agora.");
    } finally {
      event.target.value = "";
    }
  }

  function updateMapping(nextMapping: ColumnMapping) {
    setMapping(nextMapping);
    setContacts(applyOptOutBlocklist(mapRowsToContacts(rows, nextMapping), optedOutPhones));
    setJobs([]);
    setCampaign((current) => ({ ...current, status: "draft" }));
  }

  function addVariant() {
    setVariants((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        label: `Variação ${current.length + 1}`,
        body: "Olá, {{nome}}. Posso te mandar uma condição especial do {{upsell}}?",
        messageType: "buttons",
        allocationPercent: current.length ? 0 : 100,
        buttons: [
          { id: crypto.randomUUID(), label: "Quero saber mais", type: "reply" },
          optOutButton
        ]
      }
    ]);
  }

  function updateVariant(id: string, patch: Partial<MessageVariant>) {
    setVariants((current) =>
      current.map((variant) => {
        if (variant.id !== id) return variant;
        const next = { ...variant, ...patch };
        return next.messageType === "buttons"
          ? { ...next, buttons: ensureOptOutButton(next.buttons) }
          : { ...next, buttons: [] };
      })
    );
    if (!isUuid(campaign.id)) {
      setJobs([]);
      setCampaign((current) => ({ ...current, status: "draft" }));
    }
  }

  async function approveCampaign() {
    setVerifyingWhatsapp(true);
    const checkedContacts = await verifyContactsForQueueWithProvider(contacts, authFetch);
    const nextJobs = buildCampaignQueue({
      campaign,
      contacts: checkedContacts,
      variants,
      optedOutPhones
    });

    setJobs(nextJobs);
    setContacts(
      checkedContacts.map((contact) => {
        const job = nextJobs.find((candidate) => candidate.contactId === contact.id);
        if (job) return { ...contact, status: job.status };
        return contact;
      })
    );
    setCampaign((current) => ({ ...current, status: "ready" }));
    setActiveView("queue");
    setUrlState("queue", campaign.id);
    setVerifyingWhatsapp(false);
  }

  async function startCampaign() {
    if (campaign.status === "paused" && isUuid(campaign.id)) {
      await syncCampaignStatus(campaign.id, "running");
      setCampaign((current) => ({ ...current, status: "running" }));
      return;
    }

    try {
      const response = await authFetch("/api/campaigns/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          campaignId: campaign.id,
          campaign,
          contacts,
          variants,
          jobs
        })
      });

      const data = await response.json();
      if (response.ok && data.campaignId) {
        await loadCampaignSnapshot(data.campaignId, "queue");
        await refreshSavedCampaigns();
        return;
      }
      setPersistenceStatus(data.error ?? "Não foi possível iniciar a campanha.");
      return;
    } catch {
      setPersistenceStatus("Não foi possível iniciar a campanha agora.");
    }
  }

  async function pauseCampaign() {
    if (isUuid(campaign.id)) {
      await syncCampaignStatus(campaign.id, "paused");
    }
    setCampaign((current) => ({ ...current, status: "paused" }));
  }

  async function cancelCampaign() {
    if (isUuid(campaign.id)) {
      await syncCampaignStatus(campaign.id, "cancelled");
    }
    setCampaign((current) => ({ ...current, status: "cancelled" }));
  }

  async function markManualOptOut(contactId: string) {
    const selectedContact = contacts.find((contact) => contact.id === contactId);
    if (!selectedContact) return;

    setContacts((current) =>
      current.map((contact) => {
        if (contact.id !== contactId) return contact;
        setOptedOutPhones((phones) => new Set([...phones, contact.phone]));
        return { ...contact, status: "opt_out" };
      })
    );
    setJobs((current) =>
      current.map((job) =>
        job.contactId === contactId && job.status === "queued"
          ? { ...job, status: "opt_out", error: "Opt-out registrado" }
        : job
      )
    );

    try {
      const response = await authFetch("/api/opt-outs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone: selectedContact.phone,
          reason: "manual",
          source: "dashboard"
        })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        setPersistenceStatus(data.error ?? "Não foi possível registrar opt-out.");
        return;
      }

      setPersistenceStatus("Opt-out global registrado.");
      const blockedPhones = await refreshGlobalOptOuts();
      if (isUuid(campaign.id)) {
        await loadCampaignSnapshot(campaign.id, activeView, true, blockedPhones);
      }
    } catch {
      setPersistenceStatus("Não foi possível registrar opt-out agora.");
    }
  }

  async function syncCampaignStatus(
    campaignId: string,
    status: "running" | "paused" | "cancelled"
  ) {
    try {
      await authFetch(`/api/campaigns/${campaignId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });
    } catch {
      setPersistenceStatus("Não foi possível atualizar o status da campanha.");
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    if (!supabaseAuth) {
      setLoginError("Supabase não está configurado. Confira as variáveis de ambiente.");
      return;
    }

    setLoggingIn(true);
    const { error } = await supabaseAuth.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword
    });
    setLoggingIn(false);

    if (error) {
      setLoginError("E-mail ou senha inválidos.");
    }
  }

  async function handleLogout() {
    await supabaseAuth?.auth.signOut();
    setSignedIn(false);
    setUserEmail("");
    resetCurrentCampaign();
    setSavedCampaigns([]);
  }

  if (!authReady || bootstrapping) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="brand" style={{ marginBottom: 22 }}>
            <span className="brand-mark">
              <ShieldCheck size={22} />
            </span>
            Barbahra Prospecção
          </div>
          <div className="empty">Carregando sessão...</div>
        </section>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="brand" style={{ marginBottom: 22 }}>
            <span className="brand-mark">
              <ShieldCheck size={22} />
            </span>
            Barbahra Prospecção
          </div>
          <h1>Entrar</h1>
          <form className="form-grid" onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Senha</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                required
              />
            </div>
            {!supabaseAuth && (
              <div className="notice">
                Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para entrar.
              </div>
            )}
            {loginError && <div className="notice danger">{loginError}</div>}
            <button
              className="button primary"
              type="submit"
              disabled={loggingIn || !supabaseAuth}
            >
              <LogIn size={18} />
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ShieldCheck size={22} />
          </span>
          Barbahra
        </div>

        <nav className="nav-list" aria-label="Principal">
          <NavItem
            active={activeView === "home"}
            icon={<Gauge size={18} />}
            label="Início"
            onClick={() => navigateTo("home")}
          />
          <NavItem
            active={activeView === "campaigns"}
            icon={<BarChart3 size={18} />}
            label="Campanhas"
            onClick={() => navigateTo("campaigns")}
          />
          <NavItem
            active={activeView === "import"}
            icon={<FileSpreadsheet size={18} />}
            label="Importação"
            onClick={() => navigateTo("import")}
          />
          <NavItem
            active={activeView === "messages"}
            icon={<MessageSquareText size={18} />}
            label="Mensagens"
            onClick={() => navigateTo("messages")}
          />
          <NavItem
            active={activeView === "queue"}
            icon={<Send size={18} />}
            label="Fila"
            onClick={() => navigateTo("queue")}
          />
          <NavItem
            active={activeView === "logs"}
            icon={<RefreshCw size={18} />}
            label="Logs"
            onClick={() => navigateTo("logs")}
          />
        </nav>

        <div className="sidebar-footer">
          Operação com consentimento, opt-out e verificação de WhatsApp antes da fila.
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="title-block">
            <h1>{activeView === "home" ? "Painel operacional" : campaign.name}</h1>
            <p>
              <StatusBadge value={campaign.status} /> {campaign.consentBasis}
            </p>
          </div>
          <div className="toolbar">
            <label className="button" htmlFor="spreadsheet-global">
              <Upload size={18} />
              Importar
            </label>
            <input
              id="spreadsheet-global"
              type="file"
              accept=".xlsx,.csv,text/csv"
              hidden
              onChange={handleFileUpload}
            />
            <button
              className="button"
              type="button"
              onClick={createNewCampaign}
            >
              <Plus size={18} />
              Nova
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!readyToApprove || verifyingWhatsapp}
              onClick={approveCampaign}
            >
              <CheckCircle2 size={18} />
              {verifyingWhatsapp ? "Verificando..." : "Verificar e aprovar"}
            </button>
            <button className="button icon-only" type="button" title={userEmail || "Sair"} onClick={handleLogout}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {activeView === "home" && (
          <HomeView
            contacts={contacts}
            importFileName={importFileName}
            metrics={metrics}
            onGoToImport={() => navigateTo("import")}
            onGoToQueue={() => navigateTo("queue")}
            onRefresh={refreshOpenCampaign}
            canRefresh={isUuid(campaign.id)}
          />
        )}
        {activeView === "campaigns" && (
          <CampaignsView
            campaign={campaign}
            detailsOpen={campaignDetailsOpen}
            loadingSavedCampaigns={loadingSavedCampaigns}
            metrics={metrics}
            persistenceStatus={persistenceStatus}
            savingCampaign={savingCampaign}
            savedCampaigns={savedCampaigns}
            onDetailsOpenChange={setCampaignDetailsOpen}
            onDeleteCampaign={deleteCampaign}
            onOpenCampaign={(campaignId) => loadCampaignSnapshot(campaignId, "campaigns")}
            onNameChange={(name) => setCampaign((current) => ({ ...current, name }))}
            onRefreshCampaigns={refreshSavedCampaigns}
            onSaveCampaign={saveCurrentCampaign}
            onSendingConfigChange={updateSendingConfig}
          />
        )}
        {activeView === "import" && (
          <ImportView
            contacts={contacts}
            headers={headers}
            importFileName={importFileName}
            mapping={mapping}
            onDeleteContact={deleteContact}
            onFileUpload={handleFileUpload}
            onMappingChange={updateMapping}
            onOptOut={markManualOptOut}
          />
        )}
        {activeView === "messages" && (
          <MessagesView
            campaign={campaign}
            contacts={contacts}
            savingCampaign={savingCampaign}
            variants={variants}
            onAddVariant={addVariant}
            onSaveCampaign={saveCurrentCampaign}
            onUpdateVariant={updateVariant}
          />
        )}
        {activeView === "queue" && (
          <QueueView
            campaign={campaign}
            jobs={jobs}
            contacts={contacts}
            sendingConfig={campaign.sendingConfig}
            onCancel={cancelCampaign}
            onPause={pauseCampaign}
            onStart={startCampaign}
            onRefresh={refreshOpenCampaign}
          />
        )}
        {activeView === "logs" && (
          <LogsView
            logs={systemLogs}
            loading={loadingLogs}
            onRefresh={refreshSystemLogs}
          />
        )}
      </section>
    </main>
  );
}

function NavItem({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Metric({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: number | string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`status ${value}`}>{statusLabels[value] ?? value}</span>;
}

function WhatsappBadge({ value }: { value: string }) {
  return <span className={`status whatsapp-${value}`}>{whatsappLabels[value] ?? value}</span>;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function applyOptOutBlocklist(contacts: Contact[], optedOutPhones: Set<string>) {
  return contacts.map((contact) =>
    optedOutPhones.has(contact.phone)
      ? {
          ...contact,
          status: "opt_out" as const,
          errors: Array.from(new Set([...contact.errors, "Opt-out global"]))
        }
      : contact
  );
}

function fieldValue(contact: Contact, keys: string[]) {
  const normalized = Object.entries(contact.customFields).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[normalizeFieldKey(key)] = value;
      return acc;
    },
    {}
  );

  for (const key of keys) {
    const value = normalized[normalizeFieldKey(key)];
    if (value) return value;
  }

  return undefined;
}

function normalizeFieldKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function HomeView({
  contacts,
  importFileName,
  metrics,
  onGoToImport,
  onGoToQueue,
  onRefresh,
  canRefresh
}: {
  contacts: Contact[];
  importFileName: string;
  metrics: ReturnType<typeof calculateMetrics>;
  onGoToImport: () => void;
  onGoToQueue: () => void;
  onRefresh: () => void | Promise<void>;
  canRefresh: boolean;
}) {
  const lastContacts = contacts.slice(0, 5);

  return (
    <>
      <div className="section-header">
        <h2>Visão geral</h2>
        <button className="button" type="button" disabled={!canRefresh} onClick={onRefresh}>
          <RefreshCw size={18} />
          Atualizar
        </button>
      </div>
      <div className="grid columns-4">
        <Metric label="Planilhas importadas" value={metrics.spreadsheetsImported} />
        <Metric label="Contatos cadastrados" value={metrics.contacts} />
        <Metric label="Contatos na fila" value={metrics.queued} tone="warn" />
        <Metric label="Contatos enviados" value={metrics.sent} tone="good" />
      </div>
      <div className="grid columns-4 dashboard-strip">
        <Metric label="Com WhatsApp" value={metrics.whatsappValid} tone="good" />
        <Metric label="Sem WhatsApp" value={metrics.whatsappInvalid} tone="bad" />
        <Metric label="Não verificados" value={metrics.whatsappUnchecked} />
        <Metric label="Opt-out" value={metrics.optOut} tone="bad" />
      </div>

      <div className="grid columns-2">
        <section className="section">
          <div className="section-header">
            <h2>Operação</h2>
            <button className="button" type="button" onClick={onGoToQueue}>
              <Send size={18} />
              Fila
            </button>
          </div>
          <div className="section-body form-grid">
            <div className="notice">
              A verificação de WhatsApp roda na aprovação da campanha. Contatos sem WhatsApp são
              marcados e não entram na fila.
            </div>
            <div className="form-grid two">
              <Metric label="Arquivo atual" value={importFileName || "-"} />
              <Metric label="Erros de validação" value={metrics.error} tone="bad" />
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Últimos contatos</h2>
            <button className="button" type="button" onClick={onGoToImport}>
              <FileSpreadsheet size={18} />
              Revisar
            </button>
          </div>
          <div className="section-body compact-list">
            {lastContacts.map((contact) => (
              <div className="list-row" key={contact.id}>
                <div>
                  <strong>{contact.name}</strong>
                  <span>{fieldValue(contact, ["upsell", "oferta", "produto"]) || contact.phone}</span>
                </div>
                <WhatsappBadge value={contact.whatsappStatus} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function CampaignsView({
  campaign,
  detailsOpen,
  loadingSavedCampaigns,
  metrics,
  persistenceStatus,
  savingCampaign,
  savedCampaigns,
  onDetailsOpenChange,
  onDeleteCampaign,
  onOpenCampaign,
  onNameChange,
  onRefreshCampaigns,
  onSaveCampaign,
  onSendingConfigChange
}: {
  campaign: Campaign;
  detailsOpen: boolean;
  loadingSavedCampaigns: boolean;
  metrics: ReturnType<typeof calculateMetrics>;
  persistenceStatus: string;
  savingCampaign: boolean;
  savedCampaigns: SavedCampaignSummary[];
  onDetailsOpenChange: (open: boolean) => void;
  onDeleteCampaign: (campaignId: string) => void | Promise<void>;
  onOpenCampaign: (campaignId: string) => void | Promise<void>;
  onNameChange: (name: string) => void;
  onRefreshCampaigns: () => void | Promise<void>;
  onSaveCampaign: () => void | Promise<void>;
  onSendingConfigChange: (patch: Partial<CampaignSendingConfig>) => void;
}) {
  return (
    <>
      <section className="section">
        <div className="section-header">
          <h2>Campanhas salvas</h2>
          <button className="button" type="button" disabled={loadingSavedCampaigns} onClick={onRefreshCampaigns}>
            <RefreshCw size={18} />
            {loadingSavedCampaigns ? "Atualizando" : "Atualizar"}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Status</th>
                <th>Criada em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {savedCampaigns.map((savedCampaign) => (
                <tr key={savedCampaign.id}>
                  <td>{savedCampaign.name}</td>
                  <td>
                    <StatusBadge value={savedCampaign.status} />
                  </td>
                  <td>{formatDateTime(savedCampaign.createdAt)}</td>
                  <td>
                    <div className="stack">
                      <button
                        className="button"
                        type="button"
                        onClick={() => onOpenCampaign(savedCampaign.id)}
                      >
                        Abrir
                      </button>
                      <button
                        className="button danger icon-only"
                        type="button"
                        title="Excluir campanha"
                        onClick={() => onDeleteCampaign(savedCampaign.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!savedCampaigns.length && (
          <div className="empty">
            {loadingSavedCampaigns ? "Carregando campanhas..." : "Nenhuma campanha salva."}
          </div>
        )}
        {persistenceStatus && (
          <div className="section-body">
            <div className="notice">{persistenceStatus}</div>
          </div>
        )}
      </section>

      <section className="section">
        <button
          className="section-header section-toggle"
          type="button"
          onClick={() => onDetailsOpenChange(!detailsOpen)}
        >
          <span>
            {detailsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            Campanha atual
          </span>
          <StatusBadge value={campaign.status} />
        </button>
        {detailsOpen && <div className="section-body form-grid">
          <div className="form-grid two">
            <div className="field">
              <label htmlFor="campaign-name">Nome</label>
              <input
                id="campaign-name"
                value={campaign.name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="consent">Base legal</label>
              <input id="consent" value={campaign.consentBasis} readOnly />
            </div>
          </div>
          <div className="section-subtitle">Cadência da fila</div>
          <div className="form-grid two">
            <div className="field">
              <label htmlFor="min-interval">Intervalo mínimo (segundos)</label>
              <input
                id="min-interval"
                min={15}
                max={3600}
                type="number"
                value={campaign.sendingConfig.minIntervalSeconds}
                onChange={(event) =>
                  onSendingConfigChange({
                    minIntervalSeconds: Number(event.target.value)
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="max-interval">Intervalo máximo (segundos)</label>
              <input
                id="max-interval"
                min={15}
                max={7200}
                type="number"
                value={campaign.sendingConfig.maxIntervalSeconds}
                onChange={(event) =>
                  onSendingConfigChange({
                    maxIntervalSeconds: Number(event.target.value)
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="start-time">Início da janela</label>
              <input
                id="start-time"
                type="time"
                value={campaign.sendingConfig.dailyStartTime}
                onChange={(event) =>
                  onSendingConfigChange({
                    dailyStartTime: event.target.value
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="end-time">Fim da janela</label>
              <input
                id="end-time"
                type="time"
                value={campaign.sendingConfig.dailyEndTime}
                onChange={(event) =>
                  onSendingConfigChange({
                    dailyEndTime: event.target.value
                  })
                }
              />
            </div>
          </div>
          <div className="notice">
            Esses intervalos definem a cadência operacional da fila. Eles não substituem
            consentimento, opt-out, verificação de WhatsApp nem limites do provedor.
          </div>
          <div className="toolbar">
            <button
              className="button primary"
              type="button"
              disabled={!isUuid(campaign.id) || savingCampaign}
              onClick={onSaveCampaign}
            >
              <Save size={18} />
              {savingCampaign ? "Salvando" : "Salvar alterações"}
            </button>
          </div>
          <div className="grid columns-4">
            <Metric label="Erros" value={metrics.error} tone="bad" />
            <Metric label="Respondidos" value={metrics.replied} />
            <Metric label="Opt-out" value={metrics.optOut} tone="bad" />
            <Metric label="Sem WhatsApp" value={metrics.whatsappInvalid} tone="bad" />
          </div>
        </div>}
      </section>
    </>
  );
}

function ImportView({
  contacts,
  headers,
  importFileName,
  mapping,
  onDeleteContact,
  onFileUpload,
  onMappingChange,
  onOptOut
}: {
  contacts: Contact[];
  headers: string[];
  importFileName: string;
  mapping: ColumnMapping;
  onDeleteContact: (contactId: string) => void | Promise<void>;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onMappingChange: (mapping: ColumnMapping) => void;
  onOptOut: (contactId: string) => void | Promise<void>;
}) {
  return (
    <>
      <section className="section">
        <div className="section-header">
          <h2>Importação</h2>
          <label className="button primary" htmlFor="spreadsheet">
            <Upload size={18} />
            Excel/CSV
          </label>
          <input
            id="spreadsheet"
            type="file"
            accept=".xlsx,.csv,text/csv"
            hidden
            onChange={onFileUpload}
          />
        </div>
        <div className="section-body form-grid">
          {importFileName && <div className="notice">{importFileName}</div>}
          {headers.length > 0 && (
            <div className="form-grid two">
              <ColumnSelect
                label="Nome"
                headers={headers}
                value={mapping.nameColumn}
                onChange={(value) => onMappingChange({ ...mapping, nameColumn: value })}
              />
              <ColumnSelect
                label="Telefone"
                headers={headers}
                value={mapping.phoneColumn}
                onChange={(value) => onMappingChange({ ...mapping, phoneColumn: value })}
              />
              <div className="field">
                <label htmlFor="custom-columns">Variáveis extras</label>
                <select
                  id="custom-columns"
                  multiple
                  value={mapping.customColumns}
                  onChange={(event) =>
                    onMappingChange({
                      ...mapping,
                      customColumns: Array.from(event.target.selectedOptions, (option) => option.value)
                    })
                  }
                >
                  {headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </section>

      <ContactsTable contacts={contacts} onDeleteContact={onDeleteContact} onOptOut={onOptOut} />
    </>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange
}: {
  label: string;
  headers: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Selecionar</option>
        {headers.map((header, index) => (
          <option key={`${header}-${index}`} value={header}>
            {header}
          </option>
        ))}
      </select>
    </div>
  );
}

function ContactsTable({
  contacts,
  onDeleteContact,
  onOptOut
}: {
  contacts: Contact[];
  onDeleteContact: (contactId: string) => void | Promise<void>;
  onOptOut: (contactId: string) => void | Promise<void>;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <h2>Contatos</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Produto/Upsell</th>
              <th>Status</th>
              <th>WhatsApp</th>
              <th>Validação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td>{contact.name || "-"}</td>
                <td>{contact.phone || "-"}</td>
                <td>
                  {contact.customFields.upsell ||
                    contact.customFields.produto ||
                    contact.customFields.produto_comprado ||
                    fieldValue(contact, ["upsell", "oferta", "produto", "produto comprado"]) ||
                    "-"}
                </td>
                <td>
                  <StatusBadge value={contact.status} />
                </td>
                <td>
                  <WhatsappBadge value={contact.whatsappStatus} />
                </td>
                <td>{contact.errors.length ? contact.errors.join(", ") : "OK"}</td>
                <td>
                  <div className="stack">
                    <button
                      className="button icon-only"
                      type="button"
                      disabled={contact.status === "opt_out"}
                      onClick={() => onOptOut(contact.id)}
                      title="Registrar opt-out"
                    >
                      <UserX size={16} />
                    </button>
                    <button
                      className="button danger icon-only"
                      type="button"
                      onClick={() => onDeleteContact(contact.id)}
                      title="Excluir contato"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!contacts.length && <div className="empty">Nenhum contato importado.</div>}
    </section>
  );
}

function MessagesView({
  campaign,
  contacts,
  savingCampaign,
  variants,
  onAddVariant,
  onSaveCampaign,
  onUpdateVariant
}: {
  campaign: Campaign;
  contacts: Contact[];
  savingCampaign: boolean;
  variants: MessageVariant[];
  onAddVariant: () => void;
  onSaveCampaign: () => void | Promise<void>;
  onUpdateVariant: (id: string, patch: Partial<MessageVariant>) => void;
}) {
  const [previewContactId, setPreviewContactId] = useState("");
  const [pressedButtons, setPressedButtons] = useState<Record<string, string>>({});
  const previewContact =
    contacts.find((contact) => contact.id === previewContactId) ??
    contacts.find((contact) => contact.errors.length === 0) ??
    contacts[0];
  const allocationTotal = variants.reduce(
    (sum, variant) => sum + (variant.allocationPercent ?? 0),
    0
  );

  function updateButton(
    variant: MessageVariant,
    buttonId: string,
    patch: Partial<MessageButton>
  ) {
    onUpdateVariant(variant.id, {
      buttons: ensureOptOutButton(
        variant.buttons.map((button) =>
          button.id === buttonId ? { ...button, ...patch } : button
        )
      )
    });
  }

  function addButton(variant: MessageVariant) {
    const currentButtons = variant.buttons.filter((button) => !button.isOptOut);
    onUpdateVariant(variant.id, {
      buttons: ensureOptOutButton([
        ...currentButtons,
        {
          id: crypto.randomUUID(),
          label: "Quero saber mais",
          type: "reply"
        }
      ])
    });
  }

  function buttonValuePlaceholder(type: MessageButton["type"]) {
    if (type === "url") return "https://...";
    if (type === "call") return "+5511999999999";
    if (type === "copy") return "Código ou texto";
    return "";
  }

  function describeButtonAction(button: MessageButton) {
    if (button.isOptOut) return "Registra opt-out global";
    if (button.type === "url") return `Abre URL: ${button.value || "sem URL definida"}`;
    if (button.type === "call") return `Inicia ligação: ${button.value || "sem telefone definido"}`;
    if (button.type === "copy") return `Copia: ${button.value || "sem valor definido"}`;
    return `Resposta enviada: ${button.label}`;
  }

  function removeButton(variant: MessageVariant, buttonId: string) {
    onUpdateVariant(variant.id, {
      buttons: ensureOptOutButton(
        variant.buttons.filter((button) => button.id !== buttonId && !button.isOptOut)
      )
    });
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>Variações</h2>
        <div className="stack">
          <span className={`status ${allocationTotal === 100 ? "completed" : "paused"}`}>
            {allocationTotal}% distribuído
          </span>
          <button
            className="button"
            type="button"
            disabled={!isUuid(campaign.id) || savingCampaign}
            onClick={onSaveCampaign}
          >
            <Save size={18} />
            {savingCampaign ? "Salvando" : "Salvar modelos"}
          </button>
          <button className="button primary" type="button" onClick={onAddVariant}>
            <Plus size={18} />
            Variação
          </button>
        </div>
      </div>
      <div className="section-body grid">
        {variants.map((variant) => (
          <div className="message-editor" key={variant.id}>
            <div className="form-grid two">
              <div className="field">
                <label>Rótulo</label>
                <input
                  value={variant.label}
                  onChange={(event) => onUpdateVariant(variant.id, { label: event.target.value })}
                />
              </div>
              <div className="field">
                <label>Tipo de envio</label>
                <select
                  value={variant.messageType}
                  onChange={(event) =>
                    onUpdateVariant(variant.id, {
                      messageType: event.target.value as MessageVariant["messageType"],
                      buttons:
                        event.target.value === "buttons"
                          ? ensureOptOutButton(variant.buttons)
                          : []
                    })
                  }
                >
                  <option value="buttons">Mensagem com botões</option>
                </select>
              </div>
              <div className="field">
                <label>Percentual</label>
                <input
                  min={0}
                  max={100}
                  type="number"
                  value={variant.allocationPercent ?? 0}
                  onChange={(event) =>
                    onUpdateVariant(variant.id, {
                      allocationPercent: Math.min(
                        100,
                        Math.max(0, Number(event.target.value) || 0)
                      )
                    })
                  }
                />
              </div>
            </div>
            {!!contacts.length && (
              <div className="field">
                <label>Contato de teste</label>
                <select
                  value={previewContact?.id ?? ""}
                  onChange={(event) => setPreviewContactId(event.target.value)}
                >
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name} - {contact.phone}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Mensagem</label>
              <textarea
                value={variant.body}
                onChange={(event) => onUpdateVariant(variant.id, { body: event.target.value })}
              />
            </div>
            <div className="message-preview">
              <strong>Prévia</strong>
              <p>
                {previewContact
                  ? renderMessage(variant.body, previewContact).text
                  : "Importe contatos para testar variáveis."}
              </p>
              {variant.messageType === "buttons" && (
                <div className="preview-buttons">
                  {ensureOptOutButton(variant.buttons).map((button) => (
                    <button
                      className="button"
                      type="button"
                      key={button.id}
                      onClick={() =>
                        setPressedButtons((current) => ({
                          ...current,
                          [variant.id]: button.id
                        }))
                      }
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              )}
              {pressedButtons[variant.id] && (
                <span className="preview-response">
                  {describeButtonAction(
                    ensureOptOutButton(variant.buttons).find(
                      (button) => button.id === pressedButtons[variant.id]
                    ) ?? optOutButton
                  )}
                </span>
              )}
            </div>
            {variant.messageType === "buttons" && (
              <div className="form-grid">
                <div className="notice">
                  O botão “Não receber mais contatos” é obrigatório. Quando a pessoa tocar nele,
                  o telefone entra na lista global de opt-out.
                </div>
                <div className="button-list">
                  {ensureOptOutButton(variant.buttons).map((button) => (
                    <div className="button-row" key={button.id}>
                      <UserCheck size={18} />
                      <input
                        value={button.label}
                        disabled={button.isOptOut}
                        onChange={(event) =>
                          updateButton(variant, button.id, { label: event.target.value })
                        }
                      />
                      <select
                        value={button.type}
                        disabled={button.isOptOut}
                        onChange={(event) =>
                          updateButton(variant, button.id, {
                            type: event.target.value as MessageButton["type"],
                            value:
                              event.target.value === "reply" ? undefined : button.value ?? ""
                          })
                        }
                      >
                        <option value="reply">Resposta</option>
                        <option value="url">URL</option>
                        <option value="call">Telefone</option>
                        <option value="copy">Copiar</option>
                      </select>
                      {button.type !== "reply" && !button.isOptOut ? (
                        <input
                          value={button.value ?? ""}
                          placeholder={buttonValuePlaceholder(button.type)}
                          onChange={(event) =>
                            updateButton(variant, button.id, { value: event.target.value })
                          }
                        />
                      ) : (
                        <span className="button-value-placeholder">Resposta direta</span>
                      )}
                      {!button.isOptOut && (
                        <button
                          className="button danger icon-only"
                          type="button"
                          title="Remover botão"
                          onClick={() => removeButton(variant, button.id)}
                        >
                          <Square size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  className="button"
                  type="button"
                  disabled={variant.buttons.filter((button) => !button.isOptOut).length >= 2}
                  onClick={() => addButton(variant)}
                >
                  <Plus size={18} />
                  Botão
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function QueueView({
  campaign,
  jobs,
  contacts,
  sendingConfig,
  onCancel,
  onPause,
  onStart,
  onRefresh
}: {
  campaign: Campaign;
  jobs: MessageJob[];
  contacts: Contact[];
  sendingConfig: CampaignSendingConfig;
  onCancel: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const contactsWithoutWhatsapp = contacts.filter(
    (contact) => contact.whatsappStatus === "invalid"
  ).length;
  const sentCount = jobs.filter((job) => job.status === "sent").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;

  return (
    <section className="section">
      <div className="section-header">
        <h2>Fila</h2>
        <div className="stack">
          <button
            className="button"
            type="button"
            disabled={!isUuid(campaign.id)}
            onClick={onRefresh}
          >
            <RefreshCw size={18} />
            Atualizar
          </button>
          <button
            className="button primary"
            type="button"
            disabled={campaign.status !== "ready" && campaign.status !== "paused"}
            onClick={onStart}
          >
            <Play size={18} />
            Iniciar
          </button>
          <button
            className="button"
            type="button"
            disabled={campaign.status !== "running"}
            onClick={onPause}
          >
            <Pause size={18} />
            Pausar
          </button>
          <button className="button danger" type="button" onClick={onCancel}>
            <Square size={18} />
            Cancelar
          </button>
        </div>
      </div>
      <div className="section-body">
        <div className="notice">
          {sentCount} enviada(s), {queuedCount} na fila.{" "}
          {contactsWithoutWhatsapp} número(s) não possuem WhatsApp e ficaram fora da fila.
          Cadência configurada: {sendingConfig.minIntervalSeconds}s a{" "}
          {sendingConfig.maxIntervalSeconds}s, entre {sendingConfig.dailyStartTime} e{" "}
          {sendingConfig.dailyEndTime}.
          {campaign.status === "running" && " Atualizando automaticamente."}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contato</th>
              <th>Telefone</th>
              <th>Status</th>
              <th>Agendado</th>
              <th>Mensagem</th>
              <th>Erro</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const contact = contacts.find((candidate) => candidate.id === job.contactId);
              return (
                <tr key={job.id}>
                  <td>{contact?.name ?? "-"}</td>
                  <td>{contact?.phone ?? "-"}</td>
                  <td>
                    <StatusBadge value={job.status} />
                  </td>
                  <td>
                    {job.scheduledAt
                      ? `${formatDateTime(job.scheduledAt)} (${job.delaySeconds ?? 0}s)`
                      : "-"}
                  </td>
                  <td>{job.renderedMessage}</td>
                  <td>{job.error ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!jobs.length && <div className="empty">A fila será criada após a aprovação.</div>}
    </section>
  );
}

function LogsView({
  logs,
  loading,
  onRefresh
}: {
  logs: SystemLogEntry[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <h2>Logs do sistema</h2>
        <button className="button" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={18} />
          {loading ? "Atualizando" : "Atualizar"}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Evento</th>
              <th>Telefone</th>
              <th>Campanha</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDateTime(log.createdAt)}</td>
                <td>
                  <StatusBadge value={log.type} />
                </td>
                <td>{log.title}</td>
                <td>{log.phone ?? "-"}</td>
                <td>{log.campaignName ?? "-"}</td>
                <td>{log.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!logs.length && (
        <div className="empty">
          {loading ? "Carregando logs..." : "Nenhum log encontrado."}
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

function createEmptyCampaign(): Campaign {
  return {
    id: "",
    name: "Nenhuma campanha selecionada",
    status: "draft",
    consentBasis: "Base própria com consentimento",
    createdAt: new Date().toISOString(),
    sendingConfig: {
      minIntervalSeconds: 45,
      maxIntervalSeconds: 120,
      dailyStartTime: "09:00",
      dailyEndTime: "18:00"
    }
  };
}

function createDraftCampaign(): Campaign {
  return {
    ...createEmptyCampaign(),
    id: crypto.randomUUID(),
    name: "Nova campanha"
  };
}

function createDefaultVariants() {
  return demoVariants.map((variant) => ({
    ...variant,
    id: crypto.randomUUID(),
    allocationPercent: variant.allocationPercent ?? Math.round(100 / demoVariants.length),
    buttons: variant.buttons.map((button) => ({
      ...button,
      id: button.isOptOut ? "opt_out" : crypto.randomUUID()
    }))
  }));
}

function parseView(value: string | null): View {
  return value === "home" ||
    value === "campaigns" ||
    value === "import" ||
    value === "messages" ||
    value === "queue" ||
    value === "logs"
    ? value
    : "campaigns";
}
