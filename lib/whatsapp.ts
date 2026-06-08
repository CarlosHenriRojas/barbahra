import type { Contact } from "./types";

const noWhatsappError = "N\u00famero sem WhatsApp";
const inconclusiveWhatsappCheckError = "Verifica\u00e7\u00e3o de WhatsApp inconclusiva";

export function simulateWhatsappVerification(contact: Contact) {
  const lastDigit = Number(contact.phone.at(-1));
  const hasWhatsapp = Number.isNaN(lastDigit) ? false : ![0, 3].includes(lastDigit);

  return applyWhatsappCheck(contact, {
    hasWhatsapp,
    matchedPhone: contact.phone
  });
}

export function verifyContactsForQueue(contacts: Contact[]) {
  return contacts.map((contact) => {
    if (!shouldVerifyContact(contact)) return contact;
    return simulateWhatsappVerification(contact);
  });
}

type Fetcher = typeof fetch;

export async function verifyContactsForQueueWithProvider(
  contacts: Contact[],
  fetcher: Fetcher = fetch
) {
  try {
    const checkedContacts = [];

    for (const contact of contacts) {
      if (!shouldVerifyContact(contact)) {
        checkedContacts.push(contact);
        continue;
      }

      checkedContacts.push(await verifyContactWithProvider(contact, fetcher));
    }

    return checkedContacts;
  } catch {
    return contacts.map((contact) =>
      shouldVerifyContact(contact) ? applyWhatsappCheck(contact, { hasWhatsapp: undefined }) : contact
    );
  }
}

function shouldVerifyContact(contact: Contact) {
  return contact.errors.length === 0 && !contact.duplicate && contact.status !== "opt_out";
}

async function verifyContactWithProvider(contact: Contact, fetcher: Fetcher) {
  const response = await fetcher("/api/uazapi/check-number", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ phone: contact.phone })
  });

  if (!response.ok) {
    throw new Error("WhatsApp provider check failed");
  }

  const data = (await response.json()) as {
    hasWhatsapp?: boolean;
    matchedPhone?: string;
    checkedCandidates?: string[];
  };

  return applyWhatsappCheck(contact, data);
}

function applyWhatsappCheck(
  contact: Contact,
  data: {
    hasWhatsapp?: boolean;
    matchedPhone?: string;
  }
) {
  if (data.hasWhatsapp === true) {
    return {
      ...contact,
      phone: data.matchedPhone ?? contact.phone,
      whatsappStatus: "valid" as const,
      status: contact.status === "no_whatsapp" ? ("imported" as const) : contact.status,
      errors: contact.errors.filter((error) => error !== noWhatsappError)
    };
  }

  if (data.hasWhatsapp === false) {
    return {
      ...contact,
      whatsappStatus: "invalid" as const,
      status: "no_whatsapp" as const,
      errors: Array.from(new Set([...contact.errors, noWhatsappError]))
    };
  }

  return {
    ...contact,
    whatsappStatus: "unchecked" as const,
    errors: Array.from(new Set([...contact.errors, inconclusiveWhatsappCheckError]))
  };
}
