/**
 * Payment destinations, on-device.
 *
 * Demo mode has no payment provider, so it can do exactly one of the three
 * checks a real deployment does: **format**. It can tell a mistyped IFSC from a
 * well-formed one and a mistyped VPA from a plausible one. It cannot say the
 * branch exists, and it certainly cannot say the account belongs to you.
 *
 * So everything saved here stays PENDING and says why, and money never moves:
 * `/payments/top-up` and `/payments/payouts` refuse outright rather than
 * simulating a transfer. A demo that shows "verified" against an account nobody
 * checked is teaching the user to trust a tick that means nothing — and the one
 * habit this app should not build is trusting an unverified payout destination.
 */

import {
  newId,
  nowIso,
  type Database,
  type LocalBankAccount,
  type LocalUpiAccount,
  type LocalUser,
} from './core';

/* -------------------------------------------------------------- validation */

// Eleven characters: four-letter bank code, a mandatory 0, then the branch.
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_PATTERN = /^\d{9,18}$/;
const VPA_PATTERN = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/;

/** Mirrors the server's rules exactly, so a form that passes here passes there. */
export function normaliseIfsc(raw: string): string {
  const ifsc = (raw || '').trim().toUpperCase().replace(/\s/g, '');
  if (!IFSC_PATTERN.test(ifsc)) {
    throw new Error(
      'That is not a valid IFSC. It is 11 characters: four letters, a zero, then six more.',
    );
  }
  return ifsc;
}

export function normaliseAccountNumber(raw: string): string {
  const account = (raw || '').replace(/[\s-]/g, '');
  if (!ACCOUNT_PATTERN.test(account)) {
    throw new Error(
      'Account numbers are 9 to 18 digits. Check for a missing or extra digit.',
    );
  }
  return account;
}

export function normaliseVpa(raw: string): string {
  const vpa = (raw || '').trim().toLowerCase();
  if (!VPA_PATTERN.test(vpa)) {
    throw new Error('That is not a valid UPI ID. They look like name@bank.');
  }
  return vpa;
}

const NOISE = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'shri', 'smt', 'sri', 'kumari',
  'md', 'mohd', 's', 'd', 'w', 'o',
]);

function tokens(name: string): string[] {
  const folded = (name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.\-]/g, ' ');
  return folded
    .split(/\s+/)
    .filter((part) => part && part.length > 1 && !NOISE.has(part));
}

/**
 * The same tolerance the server applies: initials, expanded surnames and
 * swapped order are the same person; two different names are not.
 */
export function matchNames(
  profileName: string,
  holderName: string,
): { score: number; matched: boolean; reason: string } {
  const left = tokens(profileName);
  const right = tokens(holderName);

  if (left.length === 0 || right.length === 0) {
    return { score: 0, matched: false, reason: 'One of the names is empty.' };
  }

  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];

  let hits = 0;
  for (const token of shorter) {
    if (longer.includes(token)) {
      hits += 1;
    } else if (token.length === 1 && longer.some((o) => o.startsWith(token))) {
      hits += 1;
    } else if (
      longer.some((o) => o.startsWith(token) || token.startsWith(o))
    ) {
      hits += 0.75;
    }
  }

  const score = Math.round((hits / shorter.length) * 1000) / 1000;

  if (score >= 0.6) {
    return { score, matched: true, reason: 'The names match.' };
  }
  return {
    score,
    matched: false,
    reason:
      "The account holder's name does not look like your profile name. " +
      'Payouts must go to an account in your own name.',
  };
}

/* ------------------------------------------------------------- destinations */

/** Why nothing here can be verified without a server. */
const UNVERIFIABLE =
  'Saved on this device. Verifying that this belongs to you needs the ' +
  'TrustPay server and a payment provider, so it cannot receive a payout yet.';

export function addBankAccount(
  db: Database,
  user: LocalUser,
  input: { account_number: string; ifsc: string; holder_name: string },
): LocalBankAccount {
  const number = normaliseAccountNumber(input.account_number);
  const ifsc = normaliseIfsc(input.ifsc);

  const match = matchNames(user.full_name, input.holder_name);
  if (!match.matched) throw new Error(match.reason);

  const duplicate = db.bankAccounts.find(
    (account) =>
      account.user_id === user.id &&
      account.ifsc === ifsc &&
      account.account_last4 === number.slice(-4),
  );
  if (duplicate) throw new Error('That account is already on your profile.');

  const account: LocalBankAccount = {
    id: newId(),
    user_id: user.id,
    holder_name: input.holder_name.trim(),
    ifsc,
    // Without the registry there is no bank name to show, and inventing one
    // would be worse than admitting it is unknown.
    bank_name: 'Bank ' + ifsc.slice(0, 4),
    branch: 'Branch not looked up in demo mode',
    account_last4: number.slice(-4),
    status: 'PENDING',
    is_default: !db.bankAccounts.some((a) => a.user_id === user.id),
    verified_at: null,
    failure_reason: UNVERIFIABLE,
    name_match_score: match.score,
  };

  // The full number is deliberately not stored. Demo mode can never send a
  // payout, so keeping it would be holding a bank account number for no reason.
  db.bankAccounts.push(account);
  return account;
}

export function addUpiAccount(
  db: Database,
  user: LocalUser,
  input: { vpa: string; holder_name: string },
): LocalUpiAccount {
  const vpa = normaliseVpa(input.vpa);

  const match = matchNames(user.full_name, input.holder_name);
  if (!match.matched) throw new Error(match.reason);

  const duplicate = db.upiAccounts.find(
    (account) => account.user_id === user.id && account.vpa === vpa,
  );
  if (duplicate) throw new Error('That UPI ID is already on your profile.');

  const account: LocalUpiAccount = {
    id: newId(),
    user_id: user.id,
    vpa,
    holder_name: input.holder_name.trim(),
    status: 'PENDING',
    is_default: !db.upiAccounts.some((a) => a.user_id === user.id),
    verified_at: null,
    failure_reason: UNVERIFIABLE,
    name_match_score: match.score,
  };

  db.upiAccounts.push(account);
  return account;
}

export function serialiseBankAccount(account: LocalBankAccount) {
  return {
    id: account.id,
    holder_name: account.holder_name,
    bank_name: account.bank_name,
    branch: account.branch,
    ifsc: account.ifsc,
    account_last4: account.account_last4,
    status: account.status,
    is_default: account.is_default,
    verified_at: account.verified_at,
    failure_reason: account.failure_reason,
    name_match_score: account.name_match_score,
  };
}

export function serialiseUpiAccount(account: LocalUpiAccount) {
  return {
    id: account.id,
    vpa: account.vpa,
    holder_name: account.holder_name,
    status: account.status,
    is_default: account.is_default,
    verified_at: account.verified_at,
    failure_reason: account.failure_reason,
    name_match_score: account.name_match_score,
  };
}

export function paymentsStatus() {
  return {
    collections_enabled: false,
    payouts_enabled: false,
    google_sign_in_enabled: false,
    merchant_vpa: null,
    minimum_payout: '100.00',
    daily_payout_limit: '50000.00',
    note:
      'This build runs on your device with no payment provider, so real money ' +
      'cannot move. You can still save a bank account or UPI ID to see how it ' +
      'works — nothing is verified and nothing is charged.',
  };
}

export const nowStamp = nowIso;
