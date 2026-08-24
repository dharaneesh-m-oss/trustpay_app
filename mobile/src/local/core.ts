/**
 * The on-device core: money, storage, and the ledger.
 *
 * TrustPay runs entirely on the phone. There is no server, so the guarantees a
 * server used to provide have to be re-established here or quietly lost. Two
 * are worth keeping even offline:
 *
 *   - **Money is integer paise, never floating point.** 0.1 + 0.2 is not 0.3,
 *     and a wallet that drifts by a hundredth of a rupee is worse than useless.
 *   - **Every movement is double-entry.** Funding a milestone does not "set" a
 *     protected balance; it moves value between two accounts, and the postings
 *     must sum to zero. Balances are derived from postings rather than stored,
 *     so they cannot disagree with the history that produced them.
 *
 * What is honestly lost by going offline: this is one device keeping its own
 * records. Nothing here is authoritative against another party, and the escrow
 * is simulated rather than custodial. The UI says so rather than implying
 * otherwise.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/* --------------------------------------------------------------------- ids */

export function newId(): string {
  return Crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/* ------------------------------------------------------------------- money */

/**
 * Amounts cross the API boundary as decimal strings ("1500.00") because that is
 * what the screens already render, but they are only ever stored and computed
 * as integer paise.
 */
export function toPaise(amount: string | number): number {
  if (typeof amount === 'number') return Math.round(amount * 100);
  const cleaned = amount.trim().replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function fromPaise(paise: number): string {
  const rounded = Math.round(paise);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  return sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

/* ------------------------------------------------------------------ tables */

export type LocalUser = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  password_hash: string;
  password_salt: string;
  created_at: string;
};

/** One ledger account. `kind` is what the account means to its owner. */
export type LocalAccount = {
  id: string;
  user_id: string | null;
  kind: 'AVAILABLE' | 'PROTECTED' | 'PENDING' | 'EXTERNAL' | 'FEES';
};

export type LocalPosting = {
  id: string;
  transaction_id: string;
  account_id: string;
  /** Signed paise. Credits are positive, debits negative. */
  amount: number;
};

export type TransactionType =
  | 'TOP_UP'
  | 'WITHDRAWAL'
  | 'MILESTONE_FUNDING'
  | 'PAYMENT_RELEASE'
  | 'REFUND'
  | 'FEE';

export type LocalTransaction = {
  id: string;
  transaction_type: TransactionType;
  status: 'COMPLETED';
  description: string;
  created_at: string;
  /** Set for anything tied to a milestone, so a project can show its history. */
  milestone_id: string | null;
  idempotency_key: string | null;
};

export type MilestoneStatus =
  | 'PENDING'
  | 'FUNDED'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'RELEASED'
  | 'CANCELLED'
  | 'DISPUTED';

export type LocalMilestone = {
  id: string;
  project_id: string;
  sequence: number;
  title: string;
  description: string;
  completion_criteria: string;
  amount: number;
  due_date: string | null;
  status: MilestoneStatus;
  revision_limit: number;
  revisions_used: number;
  released_at: string | null;
};

export type LocalSubmission = {
  id: string;
  milestone_id: string;
  attempt: number;
  note: string;
  completion_percentage: number;
  evidence: { type?: string; url?: string; label?: string }[];
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type ProjectStatus =
  | 'DRAFT'
  | 'AWAITING_ACCEPTANCE'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'UNDER_DISPUTE';

export type LocalProject = {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  currency: string;
  client_id: string;
  receiver_id: string | null;
  invited_receiver_email: string | null;
  agreement_text: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type LocalCancellation = {
  id: string;
  milestone_id: string;
  project_id: string;
  status: 'PENDING_CODE' | 'APPROVED' | 'DECLINED' | 'EXPIRED';
  reason: string;
  requested_by_id: string;
  counterparty_id: string;
  code: string;
  code_sent_to: string | null;
  attempts: number;
  decline_reason: string | null;
  created_at: string;
};

export type LocalDisputeMessage = {
  id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: string;
};

export type LocalDispute = {
  id: string;
  milestone_id: string;
  project_id: string;
  raised_by_id: string;
  against_id: string;
  reason: string;
  description: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED';
  outcome: string | null;
  resolution_note: string | null;
  ai_summary: Record<string, unknown> | null;
  created_at: string;
  messages: LocalDisputeMessage[];
};

export type PayoutDestinationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'FAILED';

export type LocalBankAccount = {
  id: string;
  user_id: string;
  holder_name: string;
  ifsc: string;
  bank_name: string;
  branch: string;
  account_last4: string;
  status: PayoutDestinationStatus;
  is_default: boolean;
  verified_at: string | null;
  failure_reason: string | null;
  name_match_score: number | null;
};

export type LocalUpiAccount = {
  id: string;
  user_id: string;
  vpa: string;
  holder_name: string;
  status: PayoutDestinationStatus;
  is_default: boolean;
  verified_at: string | null;
  failure_reason: string | null;
  name_match_score: number | null;
};

export type LocalNotification = {
  id: string;
  user_id: string;
  notification_type: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string;
  target: { screen?: string; id?: string };
  is_read: boolean;
  created_at: string;
};

export type Database = {
  version: number;
  users: LocalUser[];
  accounts: LocalAccount[];
  transactions: LocalTransaction[];
  postings: LocalPosting[];
  projects: LocalProject[];
  milestones: LocalMilestone[];
  submissions: LocalSubmission[];
  cancellations: LocalCancellation[];
  disputes: LocalDispute[];
  notifications: LocalNotification[];
  bankAccounts: LocalBankAccount[];
  upiAccounts: LocalUpiAccount[];
  /** Opaque token to user id. The offline stand-in for a session. */
  sessions: Record<string, string>;
};

export function emptyDb(): Database {
  return {
    version: 1,
    users: [],
    accounts: [],
    transactions: [],
    postings: [],
    projects: [],
    milestones: [],
    submissions: [],
    cancellations: [],
    disputes: [],
    notifications: [],
    bankAccounts: [],
    upiAccounts: [],
    sessions: {},
  };
}

/* ---------------------------------------------------------------- storage */

const DB_KEY = 'trustpay.local.db.v1';

let cache: Database | null = null;

/** Serialises writes so two mutations cannot interleave read-modify-write. */
let writeChain: Promise<unknown> = Promise.resolve();

export async function loadDb(): Promise<Database> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(DB_KEY);
    if (raw) {
      cache = { ...emptyDb(), ...(JSON.parse(raw) as Database) };
      return cache;
    }
  } catch {
    // A corrupt or unreadable store is replaced rather than crashing the app;
    // there is nothing here that cannot be recreated by seeding.
  }
  cache = emptyDb();
  return cache;
}

async function persist(db: Database): Promise<void> {
  cache = db;
  await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));
}

/**
 * Read-modify-write under a promise chain.
 *
 * Two mutations firing at once - a double tap, a mutation racing a refetch -
 * would otherwise both read the same snapshot and the second would overwrite
 * the first. The chain makes them queue instead: the offline equivalent of the
 * row locks the backend used to take.
 */
export function mutate<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const next = writeChain.then(async () => {
    const db = await loadDb();
    const result = await fn(db);
    await persist(db);
    return result;
  });
  // Keep the chain alive even if this link rejects, or every later write dies
  // with it.
  writeChain = next.catch(() => undefined);
  return next;
}

export async function resetDb(): Promise<void> {
  cache = emptyDb();
  await AsyncStorage.removeItem(DB_KEY);
}

/* ------------------------------------------------------------------ ledger */

export function accountFor(
  db: Database,
  userId: string | null,
  kind: LocalAccount['kind'],
): LocalAccount {
  const found = db.accounts.find(
    (account) => account.user_id === userId && account.kind === kind,
  );
  if (found) return found;
  const created: LocalAccount = { id: newId(), user_id: userId, kind };
  db.accounts.push(created);
  return created;
}

export function balanceOf(db: Database, accountId: string): number {
  let total = 0;
  for (const posting of db.postings) {
    if (posting.account_id === accountId) total += posting.amount;
  }
  return total;
}

export type Leg = { account: LocalAccount; amount: number };

/**
 * Record one balanced transaction.
 *
 * Throws if the legs do not sum to zero. That check is the point of double
 * entry: a bug that would otherwise silently create or destroy money fails
 * loudly at the moment it happens.
 */
export function post(
  db: Database,
  input: {
    type: TransactionType;
    description: string;
    legs: Leg[];
    milestoneId?: string | null;
    idempotencyKey?: string | null;
  },
): LocalTransaction {
  const total = input.legs.reduce((sum, leg) => sum + leg.amount, 0);
  if (total !== 0) {
    throw new Error(
      'Unbalanced transaction: legs sum to ' + total + ' paise, not zero.',
    );
  }

  // Replaying a key returns the original rather than moving money twice, which
  // is what makes a retried tap safe.
  if (input.idempotencyKey) {
    const replay = db.transactions.find(
      (transaction) => transaction.idempotency_key === input.idempotencyKey,
    );
    if (replay) return replay;
  }

  const transaction: LocalTransaction = {
    id: newId(),
    transaction_type: input.type,
    status: 'COMPLETED',
    description: input.description,
    created_at: nowIso(),
    milestone_id: input.milestoneId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
  };
  db.transactions.push(transaction);

  for (const leg of input.legs) {
    db.postings.push({
      id: newId(),
      transaction_id: transaction.id,
      account_id: leg.account.id,
      amount: leg.amount,
    });
  }

  return transaction;
}

/* ------------------------------------------------------------------- auth */

export function newSalt(): string {
  return Crypto.randomUUID().replace(/-/g, '');
}

export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + ':' + password,
  );
}

/**
 * Compare in constant time.
 *
 * On a device holding only its own data this is closer to habit than defence,
 * but a comparison that short-circuits is a bad habit to keep in code that
 * checks secrets - and the cancellation OTP below uses the same helper.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
