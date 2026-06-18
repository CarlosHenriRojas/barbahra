const whatsappDisconnectedPattern = /whatsapp\s+disconnected|session\s+is\s+not\s+reconnectable/i;
const serviceUnavailablePattern = /(?:uazapi\s*)?503\b|service\s+unavailable/i;

export function isRetryableWhatsappDisconnectError(error: string | null | undefined) {
  if (!error) return false;
  return serviceUnavailablePattern.test(error) && whatsappDisconnectedPattern.test(error);
}
