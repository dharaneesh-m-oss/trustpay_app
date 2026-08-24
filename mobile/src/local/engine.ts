/**
 * The on-device API.
 *
 * Every route the screens call, implemented against the local store. The
 * response shapes match what the FastAPI backend returned exactly, because the
 * whole point is that no screen, query or type has to know the server is gone.
 *
 * The rules the backend enforced are enforced here too, and for the same
 * reasons - they are the product, not server bookkeeping:
 *
 *   - A client cannot pull protected funds back on their own. Cancelling a
 *     funded milestone needs a code that goes to the receiver.
 *   - A disputed milestone cannot be released or refunded by either side.
 *   - Milestones move through a fixed set of transitions; anything else is
 *     rejected rather than silently allowed.
 *   - Money only moves through balanced double-entry postings.
 */

import {
  accountFor,
  balanceOf,
  constantTimeEquals,
  daysAgoIso,
  daysFromNowIso,
  fromPaise,
  hashPassword,
  loadDb,
  mutate,
  newId,
  newSalt,
  nowIso,
  post,
  toPaise,
  type Database,
  type LocalMilestone,
  type LocalProject,
  type LocalTransaction,
  type LocalUser,
  type MilestoneStatus,
} from './core';
import {
  MODEL_INFO,
  analyseAgreement,
  askAssistant,
  summariseDispute,
  trustScorePayload,
} from './intelligence';
import {
  addBankAccount,
  addUpiAccount,
  normaliseIfsc as normaliseIfscOrThrow,
  paymentsStatus,
  serialiseBankAccount,
  serialiseUpiAccount,
} from './payments';

/** The demo counterparty, so the two-sided flows can actually be walked. */
export const COUNTERPARTY_EMAIL = 'aarti@trustpay.app';
export const DEMO_EMAIL = 'demo@trustpay.app';
export const DEMO_PASSWORD = 'demo1234';

/* ------------------------------------------------------------------ faults */

export class ApiFault extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const notFound = (what: string) =>
  new ApiFault(404, 'NOT_FOUND', what + ' could not be found.');

const notAllowed = (why: string) => new ApiFault(403, 'FORBIDDEN', why);

const badRequest = (why: string, details?: Record<string, unknown>) =>
  new ApiFault(422, 'VALIDATION_ERROR', why, details);

/* -------------------------------------------------------------- serialisers */

function publicUser(user: LocalUser) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
  };
}

function party(db: Database, userId: string | null) {
  if (!userId) return null;
  const user = db.users.find((candidate) => candidate.id === userId);
  if (!user) return null;
  return { id: user.id, full_name: user.full_name, email: user.email };
}

const PROTECTED_STATES: MilestoneStatus[] = [
  'FUNDED',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'DISPUTED',
];

const MILESTONE_LABELS: Record<MilestoneStatus, string> = {
  PENDING: 'Not funded',
  FUNDED: 'Protected',
  SUBMITTED: 'Awaiting your review',
  CHANGES_REQUESTED: 'Changes requested',
  RELEASED: 'Released',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
};

function serialiseMilestone(milestone: LocalMilestone) {
  return {
    id: milestone.id,
    project_id: milestone.project_id,
    sequence: milestone.sequence,
    title: milestone.title,
    description: milestone.description,
    completion_criteria: milestone.completion_criteria,
    amount: fromPaise(milestone.amount),
    currency: 'INR',
    due_date: milestone.due_date,
    status: milestone.status,
    status_label: MILESTONE_LABELS[milestone.status],
    revision_limit: milestone.revision_limit,
    revisions_used: milestone.revisions_used,
    is_funded:
      PROTECTED_STATES.includes(milestone.status) || milestone.status === 'RELEASED',
    is_released: milestone.status === 'RELEASED',
  };
}

function projectMilestones(db: Database, projectId: string) {
  return db.milestones
    .filter((milestone) => milestone.project_id === projectId)
    .sort((a, b) => a.sequence - b.sequence);
}

function serialiseProject(db: Database, project: LocalProject, userId: string) {
  const milestones = projectMilestones(db, project.id);
  const sum = (states: MilestoneStatus[]) =>
    milestones
      .filter((milestone) => states.includes(milestone.status))
      .reduce((total, milestone) => total + milestone.amount, 0);

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    total_amount: fromPaise(
      milestones.reduce((total, milestone) => total + milestone.amount, 0),
    ),
    currency: project.currency,
    protected_amount: fromPaise(sum(PROTECTED_STATES)),
    released_amount: fromPaise(sum(['RELEASED'])),
    your_role: project.client_id === userId ? 'CLIENT' : 'RECEIVER',
    milestones_total: milestones.length,
    milestones_completed: milestones.filter(
      (milestone) => milestone.status === 'RELEASED',
    ).length,
    client: party(db, project.client_id),
    receiver: party(db, project.receiver_id),
    invited_receiver_email: project.invited_receiver_email,
  };
}

function serialiseProjectDetail(
  db: Database,
  project: LocalProject,
  userId: string,
) {
  return {
    ...serialiseProject(db, project, userId),
    description: project.description,
    milestones: projectMilestones(db, project.id).map(serialiseMilestone),
    agreement_text: project.agreement_text,
    start_date: project.start_date,
    end_date: project.end_date,
    created_at: project.created_at,
  };
}

/** What one transaction did to this user's total holdings. */
function serialiseTransaction(
  db: Database,
  transaction: LocalTransaction,
  userId: string,
) {
  const mine = new Set(
    db.accounts
      .filter((account) => account.user_id === userId)
      .map((account) => account.id),
  );

  const net = db.postings
    .filter(
      (posting) =>
        posting.transaction_id === transaction.id && mine.has(posting.account_id),
    )
    .reduce((total, posting) => total + posting.amount, 0);

  // Funding moves value between two of your own accounts, so it nets to zero -
  // the money is still yours, just no longer spendable. Calling that a debit
  // would misrepresent what protection is.
  const direction = net > 0 ? 'CREDIT' : net < 0 ? 'DEBIT' : 'INTERNAL';

  const gross = db.postings
    .filter((posting) => posting.transaction_id === transaction.id)
    .reduce((total, posting) => total + Math.max(posting.amount, 0), 0);

  return {
    id: transaction.id,
    transaction_type: transaction.transaction_type,
    status: transaction.status,
    amount: fromPaise(net !== 0 ? Math.abs(net) : gross),
    currency: 'INR',
    description: transaction.description,
    created_at: transaction.created_at,
    direction_for_user: direction as 'CREDIT' | 'DEBIT' | 'INTERNAL',
    net_effect: fromPaise(net),
    is_simulated: true,
  };
}

function walletPayload(db: Database, userId: string) {
  const available = balanceOf(db, accountFor(db, userId, 'AVAILABLE').id);
  const held = balanceOf(db, accountFor(db, userId, 'PROTECTED').id);
  const pending = balanceOf(db, accountFor(db, userId, 'PENDING').id);

  return {
    wallet_id: accountFor(db, userId, 'AVAILABLE').id,
    currency: 'INR',
    available: fromPaise(available),
    protected: fromPaise(held),
    pending_settlement: fromPaise(pending),
    total: fromPaise(available + held + pending),
    is_frozen: false,
    kyc_verified: false,
    demo_mode: true,
  };
}

/* ------------------------------------------------------------ notifications */

function notify(
  db: Database,
  userId: string,
  input: {
    type: string;
    severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
    title: string;
    body: string;
    target?: { screen?: string; id?: string };
  },
) {
  db.notifications.unshift({
    id: newId(),
    user_id: userId,
    notification_type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body,
    target: input.target ?? {},
    is_read: false,
    created_at: nowIso(),
  });
}

/* -------------------------------------------------------------------- seed */

async function createUser(
  db: Database,
  input: { name: string; email: string; password: string },
): Promise<LocalUser> {
  const salt = newSalt();
  const user: LocalUser = {
    id: newId(),
    full_name: input.name,
    email: input.email.trim().toLowerCase(),
    phone: null,
    role: 'USER',
    status: 'ACTIVE',
    password_salt: salt,
    password_hash: await hashPassword(input.password, salt),
    created_at: daysAgoIso(46),
  };
  db.users.push(user);
  return user;
}

/**
 * Make sure the store has the two accounts the flows need.
 *
 * Two accounts and nothing else. There is deliberately no sample project, no
 * invented submission and no starting balance: fabricated history is
 * indistinguishable from real history once it is on the screen, and a wallet
 * that begins with money it was never given teaches the wrong thing about where
 * a balance comes from.
 *
 * Both accounts start empty. Add money (simulated, and labelled so), create a
 * project, and every screen fills with activity that actually happened.
 *
 * Runs on every launch but only fills in what is missing, so it is safe to call
 * repeatedly and never overwrites anything the user has done.
 */
export async function ensureSeeded(): Promise<void> {
  await mutate(async (db) => {
    const counterparty = db.users.find(
      (user) => user.email === COUNTERPARTY_EMAIL,
    );
    if (!counterparty) {
      // The second party, so the two-sided flows can be walked on one phone.
      await createUser(db, {
        name: 'Second Account',
        email: COUNTERPARTY_EMAIL,
        password: DEMO_PASSWORD,
      });
    }

    const existingDemo = db.users.find((user) => user.email === DEMO_EMAIL);
    if (!existingDemo) {
      await createUser(db, {
        name: 'Demo Account',
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
    }
  });
}

/* ------------------------------------------------------------------ session */

async function requireUser(db: Database, token: string | null): Promise<LocalUser> {
  const userId = token ? db.sessions[token] : null;
  const user = userId
    ? db.users.find((candidate) => candidate.id === userId)
    : null;
  if (!user) {
    throw new ApiFault(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }
  return user;
}

function issueSession(db: Database, user: LocalUser) {
  const access = newId();
  const refresh = newId();
  db.sessions[access] = user.id;
  db.sessions[refresh] = user.id;
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'bearer',
    user: publicUser(user),
  };
}

/* ------------------------------------------------------------------- router */

export type LocalRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  token: string | null;
};

export type LocalResponse = { status: number; data: unknown };

const ok = (data: unknown): LocalResponse => ({ status: 200, data });

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

/**
 * A milestone can only move where the state machine allows.
 *
 * Spelling the transitions out means an unexpected tap produces a clear refusal
 * instead of a wallet that has quietly done something impossible.
 */
const ALLOWED: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ['FUNDED', 'CANCELLED'],
  FUNDED: ['SUBMITTED', 'CANCELLED', 'DISPUTED'],
  SUBMITTED: ['RELEASED', 'CHANGES_REQUESTED', 'DISPUTED'],
  CHANGES_REQUESTED: ['SUBMITTED', 'CANCELLED', 'DISPUTED'],
  RELEASED: [],
  CANCELLED: [],
  DISPUTED: ['RELEASED', 'CANCELLED'],
};

function transition(milestone: LocalMilestone, next: MilestoneStatus) {
  if (!ALLOWED[milestone.status].includes(next)) {
    throw new ApiFault(
      409,
      'INVALID_STATE',
      'This milestone is ' +
        MILESTONE_LABELS[milestone.status].toLowerCase() +
        ', so that is not something you can do to it right now.',
    );
  }
  milestone.status = next;
}

function assertNotDisputed(db: Database, milestone: LocalMilestone) {
  const open = db.disputes.find(
    (dispute) =>
      dispute.milestone_id === milestone.id && dispute.status !== 'RESOLVED',
  );
  if (open) {
    throw notAllowed(
      'This milestone is under dispute. Funds stay protected until the dispute is resolved.',
    );
  }
}

function findMilestone(db: Database, id: string) {
  const milestone = db.milestones.find((candidate) => candidate.id === id);
  if (!milestone) throw notFound('That milestone');
  const project = db.projects.find(
    (candidate) => candidate.id === milestone.project_id,
  );
  if (!project) throw notFound('That project');
  return { milestone, project };
}

function requireMember(project: LocalProject, user: LocalUser) {
  if (project.client_id !== user.id && project.receiver_id !== user.id) {
    throw notFound('That project');
  }
}

export async function handle(request: LocalRequest): Promise<LocalResponse> {
  const parts = segments(request.path);
  const [head] = parts;

  /* ------------------------------------------------------------- auth */

  if (head === 'auth' || (head === 'users' && parts[1] === 'register')) {
    return handleAuth(request, parts);
  }

  // Everything past this point needs a session.
  return mutate(async (db) => {
    const user = await requireUser(db, request.token);

    switch (head) {
      case 'users':
        return handleUsers(db, user, request, parts);
      case 'wallet':
        return handleWallet(db, user, request, parts);
      case 'projects':
        return handleProjects(db, user, request, parts);
      case 'milestones':
        return handleMilestones(db, user, request, parts);
      case 'cancellations':
        return handleCancellations(db, user, request, parts);
      case 'disputes':
        return handleDisputes(db, user, request, parts);
      case 'notifications':
        return handleNotifications(db, user, request, parts);
      case 'ai':
        return handleAi(db, user, request, parts);
      case 'payments':
        return handlePayments(db, user, request, parts);
      default:
        throw notFound('That page');
    }
  });
}

async function handleAuth(
  request: LocalRequest,
  parts: string[],
): Promise<LocalResponse> {
  const { body } = request;

  if (parts[0] === 'users' && parts[1] === 'register') {
    return mutate(async (db) => {
      const email = str(body, 'email').trim().toLowerCase();
      const password = str(body, 'password');
      const name = str(body, 'full_name').trim();

      if (!email.includes('@')) {
        throw badRequest('That email address does not look right.', {
          fields: { email: 'Enter a valid email address.' },
        });
      }
      if (password.length < 8) {
        throw badRequest('That password is too short.', {
          fields: { password: 'Use at least 8 characters.' },
        });
      }
      if (db.users.some((candidate) => candidate.email === email)) {
        throw new ApiFault(
          409,
          'ALREADY_EXISTS',
          'An account with that email already exists on this device.',
        );
      }

      const user = await createUser(db, { name: name || 'You', email, password });
      user.created_at = nowIso();

      // No starting balance and no sample project. An account begins with
      // nothing, exactly as a real one would.
      return { status: 201, data: publicUser(user) };
    });
  }

  if (parts[1] === 'login') {
    return mutate(async (db) => {
      const email = str(body, 'email').trim().toLowerCase();
      const password = str(body, 'password');

      const user = db.users.find((candidate) => candidate.email === email);
      // One message for an unknown address and a wrong password alike, so the
      // screen cannot be used to discover which accounts exist.
      const rejection = new ApiFault(
        401,
        'INVALID_CREDENTIALS',
        'That email or password is not right.',
      );
      if (!user) throw rejection;

      const attempted = await hashPassword(password, user.password_salt);
      if (!constantTimeEquals(attempted, user.password_hash)) throw rejection;

      return ok(issueSession(db, user));
    });
  }

  if (parts[1] === 'refresh') {
    return mutate(async (db) => {
      const token = str(body, 'refresh_token');
      const userId = db.sessions[token];
      const user = userId
        ? db.users.find((candidate) => candidate.id === userId)
        : null;
      if (!user) {
        throw new ApiFault(401, 'UNAUTHENTICATED', 'Please sign in again.');
      }
      delete db.sessions[token];
      return ok(issueSession(db, user));
    });
  }

  if (parts[1] === 'logout') {
    return mutate(async (db) => {
      if (request.token) delete db.sessions[request.token];
      return ok({ ok: true });
    });
  }

  throw notFound('That page');
}

function handleUsers(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  if (parts[1] === 'me' && request.method === 'GET') {
    return ok(publicUser(user));
  }
  if (parts[1] === 'me' && request.method === 'PUT') {
    const name = str(request.body, 'full_name').trim();
    if (name) user.full_name = name;
    const phone = str(request.body, 'phone').trim();
    if (phone) user.phone = phone;
    return ok(publicUser(user));
  }
  throw notFound('That page');
}

function handleWallet(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  if (parts.length === 1 && request.method === 'GET') {
    return ok(walletPayload(db, user.id));
  }

  if (parts[1] === 'transactions') {
    const limit = Number.parseInt(request.query.limit ?? '20', 10) || 20;
    const mine = new Set(
      db.accounts
        .filter((account) => account.user_id === user.id)
        .map((account) => account.id),
    );
    const involved = db.transactions
      .filter((transaction) =>
        db.postings.some(
          (posting) =>
            posting.transaction_id === transaction.id && mine.has(posting.account_id),
        ),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return ok({
      items: involved
        .slice(0, limit)
        .map((transaction) => serialiseTransaction(db, transaction, user.id)),
      total: involved.length,
    });
  }

  if (parts[1] === 'top-up') {
    const paise = toPaise(str(request.body, 'amount'));
    if (paise <= 0) throw badRequest('Enter an amount greater than zero.');
    post(db, {
      type: 'TOP_UP',
      description: 'Added to wallet',
      idempotencyKey: str(request.body, 'idempotency_key') || null,
      legs: [
        { account: accountFor(db, null, 'EXTERNAL'), amount: -paise },
        { account: accountFor(db, user.id, 'AVAILABLE'), amount: paise },
      ],
    });
    return ok(walletPayload(db, user.id));
  }

  if (parts[1] === 'withdraw') {
    const paise = toPaise(str(request.body, 'amount'));
    if (paise <= 0) throw badRequest('Enter an amount greater than zero.');
    const available = balanceOf(db, accountFor(db, user.id, 'AVAILABLE').id);
    if (paise > available) {
      throw badRequest(
        'You can withdraw at most ' +
          fromPaise(available) +
          '. Protected funds are committed to milestones.',
      );
    }
    post(db, {
      type: 'WITHDRAWAL',
      description: 'Withdrawn from wallet',
      idempotencyKey: str(request.body, 'idempotency_key') || null,
      legs: [
        { account: accountFor(db, user.id, 'AVAILABLE'), amount: -paise },
        { account: accountFor(db, null, 'EXTERNAL'), amount: paise },
      ],
    });
    return ok(walletPayload(db, user.id));
  }

  throw notFound('That page');
}

function handleProjects(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  if (parts.length === 1 && request.method === 'GET') {
    const mine = db.projects
      .filter(
        (project) =>
          project.client_id === user.id ||
          project.receiver_id === user.id ||
          (project.invited_receiver_email ?? '') === user.email,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return ok({
      items: mine.map((project) => serialiseProject(db, project, user.id)),
      total: mine.length,
    });
  }

  if (parts.length === 1 && request.method === 'POST') {
    const body = request.body;
    const title = str(body, 'title').trim();
    if (!title) {
      throw badRequest('Give the project a title.', {
        fields: { title: 'Required.' },
      });
    }

    const rawMilestones = Array.isArray(body.milestones)
      ? (body.milestones as Record<string, unknown>[])
      : [];
    if (rawMilestones.length === 0) {
      throw badRequest('Add at least one milestone.', {
        fields: { milestones: 'Add at least one milestone.' },
      });
    }

    const receiverEmail = str(body, 'receiver_email').trim().toLowerCase();
    const receiver = receiverEmail
      ? db.users.find((candidate) => candidate.email === receiverEmail)
      : null;

    const project: LocalProject = {
      id: newId(),
      title,
      description: str(body, 'description'),
      // An invitation to someone who has not signed up on this device is held
      // against their email rather than rejected - the same pending-invitation
      // behaviour the server had.
      status: receiver ? 'AWAITING_ACCEPTANCE' : 'DRAFT',
      currency: 'INR',
      client_id: user.id,
      receiver_id: receiver ? receiver.id : null,
      invited_receiver_email: receiver ? null : receiverEmail || null,
      agreement_text: str(body, 'agreement_text') || null,
      start_date: str(body, 'start_date') || null,
      end_date: str(body, 'end_date') || null,
      created_at: nowIso(),
    };
    db.projects.push(project);

    rawMilestones.forEach((raw, index) => {
      db.milestones.push({
        id: newId(),
        project_id: project.id,
        sequence: index + 1,
        title: str(raw, 'title') || 'Milestone ' + (index + 1),
        description: str(raw, 'description'),
        completion_criteria: str(raw, 'completion_criteria'),
        amount: toPaise(str(raw, 'amount') || '0'),
        due_date: str(raw, 'due_date') || null,
        status: 'PENDING',
        revision_limit:
          typeof raw.revision_limit === 'number' ? raw.revision_limit : 2,
        revisions_used: 0,
        released_at: null,
      });
    });

    if (receiver) {
      notify(db, receiver.id, {
        type: 'PROJECT_INVITATION',
        severity: 'INFO',
        title: 'You were invited to a project',
        body: user.full_name + ' invited you to "' + title + '".',
        target: { screen: 'project', id: project.id },
      });
    }

    return { status: 201, data: serialiseProjectDetail(db, project, user.id) };
  }

  const project = db.projects.find((candidate) => candidate.id === parts[1]);
  if (!project) throw notFound('That project');

  const isInvitee =
    (project.invited_receiver_email ?? '') === user.email &&
    !project.receiver_id;
  if (!isInvitee) requireMember(project, user);

  if (parts.length === 2 && request.method === 'GET') {
    return ok(serialiseProjectDetail(db, project, user.id));
  }

  if (parts[2] === 'analysis' && request.method === 'GET') {
    return ok(analyseAgreement(project, projectMilestones(db, project.id)));
  }

  if (parts[2] === 'invite' && request.method === 'POST') {
    if (project.client_id !== user.id) {
      throw notAllowed('Only the client can invite the other side.');
    }
    const email = str(request.body, 'receiver_email').trim().toLowerCase();
    const receiver = db.users.find((candidate) => candidate.email === email);
    if (receiver) {
      if (receiver.id === user.id) {
        throw badRequest('You cannot invite yourself.');
      }
      project.receiver_id = receiver.id;
      project.invited_receiver_email = null;
      project.status = 'AWAITING_ACCEPTANCE';
      notify(db, receiver.id, {
        type: 'PROJECT_INVITATION',
        severity: 'INFO',
        title: 'You were invited to a project',
        body: user.full_name + ' invited you to "' + project.title + '".',
        target: { screen: 'project', id: project.id },
      });
    } else {
      project.invited_receiver_email = email;
    }
    return ok(serialiseProjectDetail(db, project, user.id));
  }

  if (parts[2] === 'accept' && request.method === 'POST') {
    if (isInvitee) {
      project.receiver_id = user.id;
      project.invited_receiver_email = null;
    }
    if (project.receiver_id !== user.id) {
      throw notAllowed('Only the invited party can accept this.');
    }
    project.status = 'ACTIVE';
    notify(db, project.client_id, {
      type: 'PROJECT_ACCEPTED',
      severity: 'SUCCESS',
      title: 'Invitation accepted',
      body: user.full_name + ' accepted "' + project.title + '".',
      target: { screen: 'project', id: project.id },
    });
    return ok(serialiseProjectDetail(db, project, user.id));
  }

  if (parts[2] === 'decline' && request.method === 'POST') {
    project.status = 'CANCELLED';
    notify(db, project.client_id, {
      type: 'PROJECT_DECLINED',
      severity: 'WARNING',
      title: 'Invitation declined',
      body: user.full_name + ' declined "' + project.title + '".',
      target: { screen: 'project', id: project.id },
    });
    return ok(serialiseProjectDetail(db, project, user.id));
  }

  throw notFound('That page');
}

function handleMilestones(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  const { milestone, project } = findMilestone(db, parts[1]);
  requireMember(project, user);

  const isClient = project.client_id === user.id;

  if (parts.length === 2 && request.method === 'GET') {
    return ok(serialiseMilestone(milestone));
  }

  if (parts[2] === 'submissions' && request.method === 'GET') {
    return ok(
      db.submissions
        .filter((submission) => submission.milestone_id === milestone.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  if (parts[2] === 'fund' && request.method === 'POST') {
    if (!isClient) throw notAllowed('Only the client funds a milestone.');
    assertNotDisputed(db, milestone);

    const available = balanceOf(db, accountFor(db, user.id, 'AVAILABLE').id);
    if (milestone.amount > available) {
      throw badRequest(
        'You need ' +
          fromPaise(milestone.amount) +
          ' available to protect this milestone, and you have ' +
          fromPaise(available) +
          '.',
      );
    }

    transition(milestone, 'FUNDED');
    post(db, {
      type: 'MILESTONE_FUNDING',
      description: 'Protected for ' + milestone.title,
      milestoneId: milestone.id,
      idempotencyKey: str(request.body, 'idempotency_key') || null,
      legs: [
        { account: accountFor(db, user.id, 'AVAILABLE'), amount: -milestone.amount },
        { account: accountFor(db, user.id, 'PROTECTED'), amount: milestone.amount },
      ],
    });

    if (project.receiver_id) {
      notify(db, project.receiver_id, {
        type: 'MILESTONE_FUNDED',
        severity: 'SUCCESS',
        title: 'Funds protected',
        body:
          fromPaise(milestone.amount) +
          ' is protected for "' +
          milestone.title +
          '". You can start work.',
        target: { screen: 'milestone', id: milestone.id },
      });
    }

    return ok(serialiseMilestone(milestone));
  }

  if (parts[2] === 'submit' && request.method === 'POST') {
    if (isClient) throw notAllowed('Only the receiver submits work.');
    assertNotDisputed(db, milestone);
    transition(milestone, 'SUBMITTED');

    const attempt =
      db.submissions.filter(
        (submission) => submission.milestone_id === milestone.id,
      ).length + 1;

    db.submissions.push({
      id: newId(),
      milestone_id: milestone.id,
      attempt,
      note: str(request.body, 'note'),
      completion_percentage:
        typeof request.body.completion_percentage === 'number'
          ? request.body.completion_percentage
          : 100,
      evidence: Array.isArray(request.body.evidence)
        ? (request.body.evidence as { type?: string; url?: string; label?: string }[])
        : [],
      review_note: null,
      reviewed_at: null,
      created_at: nowIso(),
    });

    notify(db, project.client_id, {
      type: 'MILESTONE_SUBMITTED',
      severity: 'INFO',
      title: 'Work submitted for review',
      body:
        user.full_name +
        ' submitted "' +
        milestone.title +
        '". Approving releases the protected funds.',
      target: { screen: 'milestone', id: milestone.id },
    });

    return ok(serialiseMilestone(milestone));
  }

  if (parts[2] === 'request-changes' && request.method === 'POST') {
    if (!isClient) throw notAllowed('Only the client can request changes.');
    assertNotDisputed(db, milestone);

    if (milestone.revisions_used >= milestone.revision_limit) {
      throw new ApiFault(
        409,
        'REVISION_LIMIT',
        'You have used all ' +
          milestone.revision_limit +
          ' revisions agreed for this milestone. Approve it, or raise a dispute.',
      );
    }

    transition(milestone, 'CHANGES_REQUESTED');
    milestone.revisions_used += 1;

    const latest = db.submissions
      .filter((submission) => submission.milestone_id === milestone.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (latest) {
      latest.review_note = str(request.body, 'note');
      latest.reviewed_at = nowIso();
    }

    if (project.receiver_id) {
      notify(db, project.receiver_id, {
        type: 'CHANGES_REQUESTED',
        severity: 'WARNING',
        title: 'Changes requested',
        body: user.full_name + ' asked for changes on "' + milestone.title + '".',
        target: { screen: 'milestone', id: milestone.id },
      });
    }

    return ok(serialiseMilestone(milestone));
  }

  if (parts[2] === 'approve' && request.method === 'POST') {
    if (!isClient) throw notAllowed('Only the client can approve and release.');
    assertNotDisputed(db, milestone);
    if (!project.receiver_id) {
      throw badRequest('This project has no receiver yet, so there is nobody to pay.');
    }

    transition(milestone, 'RELEASED');
    milestone.released_at = nowIso();

    post(db, {
      type: 'PAYMENT_RELEASE',
      description: 'Released for ' + milestone.title,
      milestoneId: milestone.id,
      idempotencyKey: str(request.body, 'idempotency_key') || null,
      legs: [
        { account: accountFor(db, user.id, 'PROTECTED'), amount: -milestone.amount },
        {
          account: accountFor(db, project.receiver_id, 'AVAILABLE'),
          amount: milestone.amount,
        },
      ],
    });

    notify(db, project.receiver_id, {
      type: 'PAYMENT_RELEASED',
      severity: 'SUCCESS',
      title: 'Payment released',
      body:
        fromPaise(milestone.amount) +
        ' for "' +
        milestone.title +
        '" is now in your available balance.',
      target: { screen: 'milestone', id: milestone.id },
    });

    const remaining = projectMilestones(db, project.id).filter(
      (candidate) =>
        candidate.status !== 'RELEASED' && candidate.status !== 'CANCELLED',
    );
    if (remaining.length === 0) project.status = 'COMPLETED';

    return ok(serialiseMilestone(milestone));
  }

  throw notFound('That page');
}

function handleCancellations(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  const serialise = (cancellation: (typeof db.cancellations)[number]) => ({
    id: cancellation.id,
    milestone_id: cancellation.milestone_id,
    project_id: cancellation.project_id,
    status: cancellation.status,
    reason: cancellation.reason,
    requested_by_id: cancellation.requested_by_id,
    counterparty_id: cancellation.counterparty_id,
    code_sent_to: cancellation.code_sent_to,
    decline_reason: cancellation.decline_reason,
    demo_mode: true,
  });

  if (parts.length === 1 && request.method === 'POST') {
    const { milestone, project } = findMilestone(
      db,
      str(request.body, 'milestone_id'),
    );
    requireMember(project, user);
    assertNotDisputed(db, milestone);

    if (!PROTECTED_STATES.includes(milestone.status)) {
      throw new ApiFault(
        409,
        'INVALID_STATE',
        'Only a funded milestone can be cancelled.',
      );
    }

    const counterpartyId =
      project.client_id === user.id ? project.receiver_id : project.client_id;
    if (!counterpartyId) {
      throw badRequest('This project has no other party yet.');
    }

    const counterparty = db.users.find(
      (candidate) => candidate.id === counterpartyId,
    );
    const code = String(Math.floor(100000 + Math.random() * 900000));

    const cancellation = {
      id: newId(),
      milestone_id: milestone.id,
      project_id: project.id,
      status: 'PENDING_CODE' as const,
      reason: str(request.body, 'reason'),
      requested_by_id: user.id,
      counterparty_id: counterpartyId,
      code,
      code_sent_to: counterparty ? counterparty.email : null,
      attempts: 0,
      decline_reason: null,
      created_at: nowIso(),
    };
    db.cancellations.push(cancellation);

    // There is no SMS or email here, so the code is delivered the only way an
    // offline app can deliver it: as a notification to the person who has to
    // approve. It still goes to the counterparty, never to the requester -
    // that is the whole protection.
    notify(db, counterpartyId, {
      type: 'CANCELLATION_REQUESTED',
      severity: 'CRITICAL',
      title: 'Cancellation needs your code',
      body:
        user.full_name +
        ' wants to cancel "' +
        milestone.title +
        '". Your code is ' +
        code +
        '. Only share it if you agree.',
      target: { screen: 'cancellation', id: cancellation.id },
    });

    return { status: 201, data: serialise(cancellation) };
  }

  const cancellation = db.cancellations.find(
    (candidate) => candidate.id === parts[1],
  );
  if (!cancellation) throw notFound('That cancellation request');

  if (
    cancellation.requested_by_id !== user.id &&
    cancellation.counterparty_id !== user.id
  ) {
    throw notFound('That cancellation request');
  }

  if (parts.length === 2 && request.method === 'GET') {
    return ok(serialise(cancellation));
  }

  if (parts[2] === 'verify' && request.method === 'POST') {
    // Only the receiver of the code can use it. Without this the client could
    // cancel unilaterally, which is exactly what the feature exists to prevent.
    if (cancellation.counterparty_id !== user.id) {
      throw notAllowed(
        'Only the other party can enter this code. That is what stops a cancellation being forced through.',
      );
    }
    if (cancellation.status !== 'PENDING_CODE') {
      throw new ApiFault(409, 'INVALID_STATE', 'This request is already settled.');
    }
    if (cancellation.attempts >= 5) {
      cancellation.status = 'EXPIRED';
      throw new ApiFault(
        429,
        'TOO_MANY_ATTEMPTS',
        'Too many incorrect codes. This request has expired.',
      );
    }

    const supplied = str(request.body, 'code').trim();
    if (!constantTimeEquals(supplied, cancellation.code)) {
      cancellation.attempts += 1;
      throw badRequest('That code is not right.', {
        fields: { code: 'Incorrect code.' },
      });
    }

    cancellation.status = 'APPROVED';

    const { milestone, project } = findMilestone(db, cancellation.milestone_id);
    transition(milestone, 'CANCELLED');

    post(db, {
      type: 'REFUND',
      description: 'Refunded after cancelling ' + milestone.title,
      milestoneId: milestone.id,
      legs: [
        {
          account: accountFor(db, project.client_id, 'PROTECTED'),
          amount: -milestone.amount,
        },
        {
          account: accountFor(db, project.client_id, 'AVAILABLE'),
          amount: milestone.amount,
        },
      ],
    });

    notify(db, cancellation.requested_by_id, {
      type: 'CANCELLATION_APPROVED',
      severity: 'SUCCESS',
      title: 'Cancellation approved',
      body:
        '"' +
        milestone.title +
        '" was cancelled and ' +
        fromPaise(milestone.amount) +
        ' returned to the client.',
      target: { screen: 'milestone', id: milestone.id },
    });

    return ok(serialise(cancellation));
  }

  if (parts[2] === 'decline' && request.method === 'POST') {
    if (cancellation.counterparty_id !== user.id) {
      throw notAllowed('Only the other party can decline this.');
    }
    cancellation.status = 'DECLINED';
    cancellation.decline_reason = str(request.body, 'reason');

    notify(db, cancellation.requested_by_id, {
      type: 'CANCELLATION_DECLINED',
      severity: 'WARNING',
      title: 'Cancellation declined',
      body:
        'The other party declined the cancellation. The milestone stays funded.',
      target: { screen: 'cancellation', id: cancellation.id },
    });

    return ok(serialise(cancellation));
  }

  throw notFound('That page');
}

function handleDisputes(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  const visible = () =>
    db.disputes.filter(
      (dispute) =>
        dispute.raised_by_id === user.id || dispute.against_id === user.id,
    );

  if (parts.length === 1 && request.method === 'GET') {
    return ok(
      visible().sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  if (parts.length === 1 && request.method === 'POST') {
    const { milestone, project } = findMilestone(
      db,
      str(request.body, 'milestone_id'),
    );
    requireMember(project, user);

    const againstId =
      project.client_id === user.id ? project.receiver_id : project.client_id;
    if (!againstId) throw badRequest('This project has no other party yet.');

    if (milestone.status !== 'DISPUTED') {
      transition(milestone, 'DISPUTED');
    }
    project.status = 'UNDER_DISPUTE';

    const dispute = {
      id: newId(),
      milestone_id: milestone.id,
      project_id: project.id,
      raised_by_id: user.id,
      against_id: againstId,
      reason: str(request.body, 'reason'),
      description: str(request.body, 'description'),
      status: 'OPEN' as const,
      outcome: null,
      resolution_note: null,
      ai_summary: null,
      created_at: nowIso(),
      messages: [],
    };
    db.disputes.push(dispute);

    notify(db, againstId, {
      type: 'DISPUTE_RAISED',
      severity: 'CRITICAL',
      title: 'A dispute was raised',
      body:
        user.full_name +
        ' raised a dispute on "' +
        milestone.title +
        '". The funds stay protected until it is resolved.',
      target: { screen: 'dispute', id: dispute.id },
    });

    return { status: 201, data: dispute };
  }

  const dispute = db.disputes.find((candidate) => candidate.id === parts[1]);
  if (!dispute) throw notFound('That dispute');
  if (dispute.raised_by_id !== user.id && dispute.against_id !== user.id) {
    throw notFound('That dispute');
  }

  if (parts.length === 2 && request.method === 'GET') return ok(dispute);

  if (parts[2] === 'ai-summary' && request.method === 'POST') {
    dispute.ai_summary = summariseDispute(db, dispute.id);
    return ok(dispute.ai_summary);
  }

  throw notFound('That page');
}

function handleNotifications(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  const mine = db.notifications.filter(
    (notification) => notification.user_id === user.id,
  );

  if (parts.length === 1 && request.method === 'GET') {
    return ok({
      items: mine.map((notification) => ({
        id: notification.id,
        notification_type: notification.notification_type,
        severity: notification.severity,
        title: notification.title,
        body: notification.body,
        target: notification.target,
        is_read: notification.is_read,
        created_at: notification.created_at,
      })),
      unread: mine.filter((notification) => !notification.is_read).length,
    });
  }

  if (parts[1] === 'read-all' && request.method === 'POST') {
    mine.forEach((notification) => {
      notification.is_read = true;
    });
    return ok({ ok: true });
  }

  if (parts[2] === 'read' && request.method === 'POST') {
    const notification = mine.find((candidate) => candidate.id === parts[1]);
    if (!notification) throw notFound('That notification');
    notification.is_read = true;
    return ok({ ok: true });
  }

  throw notFound('That page');
}

function handleAi(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  if (parts[1] === 'status') {
    return ok({
      engine: 'rules',
      model: null,
      claude_connected: false,
      note: 'This build runs entirely on your device. Answers come from built-in checks, not a language model.',
      trust_score_model: MODEL_INFO,
    });
  }

  if (parts[1] === 'trust-score' && parts.length === 2) {
    const payload = trustScorePayload(db, user.id);
    return ok({
      score: payload.score,
      band: payload.band,
      band_label: payload.band_label,
      confidence: payload.confidence,
      positive_reasons: payload.positive_reasons,
      risk_reasons: payload.risk_reasons,
      delta: payload.delta,
      limited_data_notice: payload.limited_data_notice,
    });
  }

  if (parts[2] === 'explanation') {
    const payload = trustScorePayload(db, user.id);
    return ok({
      ...payload,
      narrative: null,
      model_info: MODEL_INFO,
    });
  }

  if (parts[1] === 'assistant' && request.method === 'POST') {
    return ok(askAssistant(str(request.body, 'question')));
  }

  throw notFound('That page');
}

function handlePayments(
  db: Database,
  user: LocalUser,
  request: LocalRequest,
  parts: string[],
): LocalResponse {
  if (parts[1] === 'status') {
    return ok(paymentsStatus());
  }

  if (parts[1] === 'bank-accounts') {
    if (request.method === 'GET') {
      return ok(
        db.bankAccounts
          .filter((account) => account.user_id === user.id)
          .map(serialiseBankAccount),
      );
    }
    if (request.method === 'POST') {
      try {
        const account = addBankAccount(db, user, {
          account_number: str(request.body, 'account_number'),
          ifsc: str(request.body, 'ifsc'),
          holder_name: str(request.body, 'holder_name'),
        });
        return { status: 201, data: serialiseBankAccount(account) };
      } catch (caught) {
        throw badRequest(
          caught instanceof Error ? caught.message : 'Those details are not valid.',
        );
      }
    }
  }

  if (parts[1] === 'upi-accounts') {
    if (request.method === 'GET') {
      return ok(
        db.upiAccounts
          .filter((account) => account.user_id === user.id)
          .map(serialiseUpiAccount),
      );
    }
    if (request.method === 'POST') {
      try {
        const account = addUpiAccount(db, user, {
          vpa: str(request.body, 'vpa'),
          holder_name: str(request.body, 'holder_name'),
        });
        return { status: 201, data: serialiseUpiAccount(account) };
      } catch (caught) {
        throw badRequest(
          caught instanceof Error ? caught.message : 'That UPI ID is not valid.',
        );
      }
    }
  }

  if (parts[1] === 'ifsc') {
    // Format only. There is no registry to ask on a device with no server, and
    // returning an invented bank name would be worse than saying so.
    try {
      const ifsc = normaliseIfscOrThrow(str(request.query, 'ifsc') || parts[2] || '');
      return ok({
        ifsc,
        bank: 'Bank ' + ifsc.slice(0, 4),
        branch: 'Not looked up — demo mode has no bank registry',
        city: '',
        state: '',
        supports_imps: false,
        supports_neft: false,
      });
    } catch (caught) {
      throw badRequest(
        caught instanceof Error ? caught.message : 'That IFSC is not valid.',
      );
    }
  }

  if (parts[1] === 'payouts') {
    if (request.method === 'GET') return ok([]);
    // Refusing is the honest answer. Simulating a payout would teach someone
    // that money left, when nothing did.
    throw new ApiFault(
      503,
      'PAYMENTS_NOT_ENABLED',
      'Withdrawals need the TrustPay server and a payment provider. This build ' +
        'runs on your device, so it cannot move real money.',
    );
  }

  if (parts[1] === 'top-up') {
    throw new ApiFault(
      503,
      'PAYMENTS_NOT_ENABLED',
      'Adding money by UPI needs the TrustPay server and a payment provider. ' +
        'In this build, use Add money to credit simulated funds instead.',
    );
  }

  throw notFound('That page');
}

/** Exposed for the profile screen, so a demo can be wiped and restarted. */
export async function factoryReset(): Promise<void> {
  const { resetDb } = await import('./core');
  await resetDb();
  await ensureSeeded();
}

export { loadDb };
