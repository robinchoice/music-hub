// Bank transfer to the studio's account: IBAN check and the EPC069-12 payload of a GiroCode.

/** Removes spaces and upper-cases, the form stored in payment_accounts.iban. */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 check: country code, length 15–34, mod-97 checksum of the normalized IBAN. */
export function validIban(iban: string): boolean {
  const value = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  // Country code and check digits move to the end, letters become 10..35
  let rest = 0;
  for (const char of value.slice(4) + value.slice(0, 4)) {
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** Only the last 4 characters visible, e.g. "•••• •••• •••• •••• 1234". */
export function maskIban(iban: string): string {
  return `•••• •••• •••• •••• ${normalizeIban(iban).slice(-4)}`;
}

// One line of the payload: no line break inside (it would shift every later field), at most `max` characters
function field(value: string, max: number): string {
  return Array.from(value.replace(/[\r\n]+/g, ' ').trim()).slice(0, max).join('').trim();
}

/**
 * EPC069-12 payload, lines joined by "\n": BCD, 002, 1 (UTF-8), SCT, BIC (may be empty), name (max 70),
 * IBAN, "EUR" + amount with two decimals (e.g. EUR480.00), empty purpose, empty structured reference,
 * remittance text (max 140).
 */
export function epcPayload(input: { name: string; iban: string; bic: string | null; amountCents: number; remittance: string }): string {
  // EPC069-12 allows EUR0.01 to EUR999999999.99
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 99_999_999_999) {
    throw new Error('Amount out of range for a GiroCode');
  }
  const euros = Math.floor(input.amountCents / 100);
  const cents = String(input.amountCents % 100).padStart(2, '0');
  return [
    'BCD',
    '002',
    '1',
    'SCT',
    (input.bic ?? '').trim().toUpperCase(),
    field(input.name, 70),
    normalizeIban(input.iban),
    `EUR${euros}.${cents}`,
    '',
    '',
    field(input.remittance, 140),
  ].join('\n');
}
