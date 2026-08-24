/**
 * Exercises the offline engine in Node by stubbing the two native modules it
 * touches - AsyncStorage and expo-crypto - so the money logic can be tested
 * without a device.
 *
 * The two checks at the end are the ones worth keeping: every transaction's
 * postings must sum to zero, and the whole ledger must sum to zero. Together
 * they mean no code path can quietly invent or destroy money.
 *
 * The fixtures are built by the test rather than shipped in the app. That is
 * the right way round: seeded sample data would be indistinguishable from real
 * data on a user's screen, and a test that leans on it is really testing the
 * seed rather than the engine.
 *
 * The fixtures are built by the test rather than shipped in the app. That is
 * the right way round: seeded sample data would be indistinguishable from real
 * data on a user's screen, and a test that leans on it is really testing the
 * seed rather than the engine.
 *
 * Run with: npm run test:offline
 */

const Module = require('module');
const crypto = require('crypto');

const memory = new Map();

const stubs = {
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: {
      getItem: async (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: async (k, v) => void memory.set(k, v),
      removeItem: async (k) => void memory.delete(k),
    },
  },
  'expo-crypto': {
    __esModule: true,
    randomUUID: () => crypto.randomUUID(),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_alg, value) =>
      crypto.createHash('sha256').update(value).digest('hex'),
  },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs[request]) return stubs[request];
  return realLoad(request, parent, isMain);
};

const engine = require('../.offline-build/engine.js');
const core = require('../.offline-build/core.js');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    failed += 1;
    console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''));
  }
}

async function call(method, path, body, token, query) {
  return engine.handle({
    method,
    path,
    body: body || {},
    token: token || null,
    query: query || {},
  });
}

async function expectFault(label, fn, code) {
  try {
    await fn();
    check(label, false, 'expected a refusal, got success');
  } catch (error) {
    check(
      label,
      error instanceof engine.ApiFault && (!code || error.code === code),
      'got ' + (error && error.code ? error.code : error),
    );
  }
}

/** Every posting in the store must net to zero per transaction. */
async function assertLedgerBalanced(label) {
  const db = await core.loadDb();
  const sums = new Map();
  for (const posting of db.postings) {
    sums.set(
      posting.transaction_id,
      (sums.get(posting.transaction_id) || 0) + posting.amount,
    );
  }
  const broken = [...sums.entries()].filter(([, total]) => total !== 0);
  check(label, broken.length === 0, JSON.stringify(broken.slice(0, 3)));
}

/** Money must never be created: all user balances plus external must net zero. */
async function assertConservation(label) {
  const db = await core.loadDb();
  const total = db.postings.reduce((sum, posting) => sum + posting.amount, 0);
  check(label, total === 0, 'net ' + total + ' paise');
}

async function main() {
  console.log('\n--- seeding ---');
  await engine.ensureSeeded();
  await engine.ensureSeeded(); // must be idempotent
  const db = await core.loadDb();
  check('seeding twice does not duplicate users', db.users.length === 2, String(db.users.length));
  check(
    'a seeded account starts with no fabricated money',
    db.postings.length === 0,
    db.postings.length + ' postings',
  );
  check(
    'a seeded account starts with no fabricated projects',
    db.projects.length === 0,
    db.projects.length + ' projects',
  );
  check(
    'a seeded account starts with no fabricated money',
    db.postings.length === 0,
    db.postings.length + ' postings',
  );
  check(
    'a seeded account starts with no fabricated projects',
    db.projects.length === 0,
    db.projects.length + ' projects',
  );

  console.log('\n--- auth ---');
  const login = await call('POST', 'auth/login', {
    email: engine.DEMO_EMAIL,
    password: engine.DEMO_PASSWORD,
  });
  const token = login.data.access_token;
  check('demo account signs in', Boolean(token));

  await expectFault(
    'wrong password is refused',
    () => call('POST', 'auth/login', { email: engine.DEMO_EMAIL, password: 'nope' }),
    'INVALID_CREDENTIALS',
  );
  await expectFault(
    'unknown token is rejected',
    () => call('GET', 'wallet', {}, 'not-a-token'),
    'UNAUTHENTICATED',
  );

  const aarti = (
    await call('POST', 'auth/login', {
      email: engine.COUNTERPARTY_EMAIL,
      password: engine.DEMO_PASSWORD,
    })
  ).data.access_token;

  console.log('\n--- wallet ---');
  let wallet = (await call('GET', 'wallet', {}, token)).data;
  check('a new wallet is empty', Number(wallet.available) === 0, wallet.available);
  check('demo mode is declared', wallet.demo_mode === true);

  // Everything below needs funds, so put them in deliberately - which is now
  // the only way a balance appears at all.
  await call('POST', 'wallet/top-up', { amount: '90000.00' }, token);
  wallet = (await call('GET', 'wallet', {}, token)).data;
  const startingAvailable = wallet.available;
  check('adding money credits the wallet', Number(startingAvailable) === 90000, startingAvailable);

  await call('POST', 'wallet/top-up', { amount: '500.00', idempotency_key: 'k1' }, token);
  await call('POST', 'wallet/top-up', { amount: '500.00', idempotency_key: 'k1' }, token);
  wallet = (await call('GET', 'wallet', {}, token)).data;
  check(
    'replayed idempotency key does not double-credit',
    Number(wallet.available) === Number(startingAvailable) + 500,
    wallet.available,
  );

  await expectFault(
    'cannot withdraw more than available',
    () => call('POST', 'wallet/withdraw', { amount: '99999999.00' }, token),
    'VALIDATION_ERROR',
  );

  console.log('\n--- escrow happy path ---');
  const built = (
    await call(
      'POST',
      'projects',
      {
        title: 'Website build',
        description: 'Two stages.',
        receiver_email: engine.COUNTERPARTY_EMAIL,
        milestones: [
          { title: 'Design', description: 'Layouts', completion_criteria: 'A shared file with five page layouts.', amount: '18000.00' },
          { title: 'Build', description: 'Front end', completion_criteria: 'A staging link matching the designs.', amount: '26000.00' },
        ],
      },
      token,
    )
  ).data;
  await call('POST', 'projects/' + built.id + '/accept', {}, aarti);

  const projects = (await call('GET', 'projects', {}, token)).data;
  check('the created project is listed', projects.items.length === 1, String(projects.items.length));

  const detail = (await call('GET', 'projects/' + built.id, {}, token)).data;
  const pending = detail.milestones[0];
  const submitted = detail.milestones[1];
  check('milestones start unfunded', pending.status === 'PENDING', pending.status);

  const beforeFund = (await call('GET', 'wallet', {}, token)).data;
  await call('POST', 'milestones/' + pending.id + '/fund', { idempotency_key: 'f1' }, token);
  const afterFund = (await call('GET', 'wallet', {}, token)).data;

  check(
    'funding moves money out of available',
    Number(afterFund.available) < Number(beforeFund.available),
    afterFund.available,
  );
  check(
    'funding moves the same money into protected',
    Number(afterFund.protected) - Number(beforeFund.protected) ===
      Number(beforeFund.available) - Number(afterFund.available),
  );
  check(
    'funding leaves the total untouched',
    Number(afterFund.total) === Number(beforeFund.total),
    afterFund.total + ' vs ' + beforeFund.total,
  );

  await expectFault(
    'receiver cannot fund',
    () => call('POST', 'milestones/' + pending.id + '/fund', {}, aarti),
    'FORBIDDEN',
  );
  await expectFault(
    'cannot fund an already funded milestone',
    () => call('POST', 'milestones/' + pending.id + '/fund', {}, token),
    'INVALID_STATE',
  );
  await expectFault(
    'client cannot submit work',
    () => call('POST', 'milestones/' + pending.id + '/submit', { note: 'x' }, token),
    'FORBIDDEN',
  );

  await call(
    'POST',
    'milestones/' + pending.id + '/submit',
    { note: 'Done', completion_percentage: 100, evidence: [] },
    aarti,
  );

  const aartiBefore = (await call('GET', 'wallet', {}, aarti)).data;
  const clientBefore = (await call('GET', 'wallet', {}, token)).data;
  await call('POST', 'milestones/' + pending.id + '/approve', { idempotency_key: 'r1' }, token);
  const aartiAfter = (await call('GET', 'wallet', {}, aarti)).data;
  const clientAfter = (await call('GET', 'wallet', {}, token)).data;

  check(
    'approving pays the receiver',
    Number(aartiAfter.available) > Number(aartiBefore.available),
    aartiAfter.available,
  );
  check(
    'the receiver gains exactly what the client releases',
    Number(aartiAfter.available) - Number(aartiBefore.available) ===
      Number(clientBefore.protected) - Number(clientAfter.protected),
  );

  await assertLedgerBalanced('every transaction still balances');
  await assertConservation('no money was created or destroyed');

  console.log('\n--- cancellation protection ---');
  await call('POST', 'milestones/' + submitted.id + '/fund', {}, token);
  const cancellation = (
    await call(
      'POST',
      'cancellations',
      { milestone_id: submitted.id, reason: 'No longer needed' },
      token,
    )
  ).data;
  check('cancellation starts pending a code', cancellation.status === 'PENDING_CODE');

  const stored = (await core.loadDb()).cancellations.find((c) => c.id === cancellation.id);

  await expectFault(
    'the requester cannot enter the code themselves',
    () => call('POST', 'cancellations/' + cancellation.id + '/verify', { code: stored.code }, token),
    'FORBIDDEN',
  );
  await expectFault(
    'a wrong code is refused',
    () => call('POST', 'cancellations/' + cancellation.id + '/verify', { code: '000000' }, aarti),
    'VALIDATION_ERROR',
  );

  const refundBefore = (await call('GET', 'wallet', {}, token)).data;
  const verified = (
    await call('POST', 'cancellations/' + cancellation.id + '/verify', { code: stored.code }, aarti)
  ).data;
  const refundAfter = (await call('GET', 'wallet', {}, token)).data;

  check('receiver can approve with the code', verified.status === 'APPROVED');
  check(
    'cancelling returns the money to the client',
    Number(refundAfter.available) > Number(refundBefore.available),
    refundAfter.available,
  );
  check(
    'the refund leaves the total unchanged',
    Number(refundAfter.total) === Number(refundBefore.total),
  );

  console.log('\n--- disputes freeze funds ---');
  const disputed = (
    await call(
      'POST',
      'projects',
      {
        title: 'Dispute test',
        description: 'd',
        receiver_email: engine.COUNTERPARTY_EMAIL,
        milestones: [
          { title: 'One', description: 'd', completion_criteria: 'A shared file that matches the spec.', amount: '1000.00' },
        ],
      },
      token,
    )
  ).data;
  await call('POST', 'projects/' + disputed.id + '/accept', {}, aarti);
  const target = disputed.milestones[0];
  await call('POST', 'milestones/' + target.id + '/fund', {}, token);
  await call('POST', 'disputes', { milestone_id: target.id, reason: 'Quality', description: 'x' }, token);

  await expectFault(
    'a disputed milestone cannot be released',
    () => call('POST', 'milestones/' + target.id + '/approve', {}, token),
    'FORBIDDEN',
  );
  await expectFault(
    'a disputed milestone cannot be cancelled',
    () => call('POST', 'cancellations', { milestone_id: target.id, reason: 'x' }, token),
    'FORBIDDEN',
  );

  console.log('\n--- invitations to someone not on this device ---');
  const invited = (
    await call(
      'POST',
      'projects',
      {
        title: 'Pending invite',
        description: 'd',
        receiver_email: 'stranger@example.com',
        milestones: [{ title: 'One', description: 'd', completion_criteria: 'Something checkable here.', amount: '100.00' }],
      },
      token,
    )
  ).data;
  check('invitation is held against the email', invited.invited_receiver_email === 'stranger@example.com');
  check('project has no receiver yet', invited.receiver === null);

  console.log('\n--- intelligence ---');
  const score = (await call('GET', 'ai/trust-score', {}, token)).data;
  check('trust score is in range', score.score >= 5 && score.score <= 99, String(score.score));
  const explanation = (await call('GET', 'ai/trust-score/explanation', {}, token)).data;
  const contributionTotal = Object.values(explanation.contributions).reduce((a, b) => a + b, 0);
  check(
    'contributions reconstruct the score',
    Math.abs(Math.round(Math.min(99, Math.max(5, 62 + contributionTotal))) - score.score) <= 1,
    String(contributionTotal),
  );

  const status = (await call('GET', 'ai/status', {}, token)).data;
  check('engine is honestly reported as rules', status.engine === 'rules' && status.claude_connected === false);

  const answer = (await call('POST', 'ai/assistant', { question: 'how does escrow work?' }, token)).data;
  check('assistant answers a known question', answer.answer.length > 40 && answer.engine === 'rules');
  const unknown = (await call('POST', 'ai/assistant', { question: 'what is the capital of Peru' }, token)).data;
  check('assistant declines what it does not know', /only answer questions about how TrustPay/i.test(unknown.answer));

  const analysis = (await call('GET', 'projects/' + invited.id + '/analysis', {}, token)).data;
  check('agreement analysis returns findings', Array.isArray(analysis.findings) && analysis.engine === 'rules');

  console.log('\n--- notifications ---');
  const notes = (await call('GET', 'notifications', {}, aarti)).data;
  check('counterparty received notifications', notes.items.length > 0, String(notes.items.length));
  await call('POST', 'notifications/read-all', {}, aarti);
  const after = (await call('GET', 'notifications', {}, aarti)).data;
  check('read-all clears the badge', after.unread === 0, String(after.unread));

  console.log('\n--- transactions ---');
  const txns = (await call('GET', 'wallet/transactions', {}, token, { limit: '50' })).data;
  check('transactions are listed', txns.items.length > 0, String(txns.items.length));
  const funding = txns.items.find((t) => t.transaction_type === 'MILESTONE_FUNDING');
  check(
    'funding reads as internal, not a debit',
    funding && funding.direction_for_user === 'INTERNAL',
    funding ? funding.direction_for_user : 'none',
  );

  console.log('\n--- payout destinations (the screens that 404d before) ---');
  const paymentsState = (await call('GET', 'payments/status', {}, token)).data;
  check(
    'payments status is reachable and honest',
    paymentsState.collections_enabled === false &&
      paymentsState.payouts_enabled === false,
    JSON.stringify(paymentsState).slice(0, 60),
  );

  const upi = (
    await call('POST', 'payments/upi-accounts', { vpa: 'demo@okhdfcbank', holder_name: 'Demo Account' }, token)
  ).data;
  check('a UPI ID can be saved', upi.vpa === 'demo@okhdfcbank', upi.vpa);
  check(
    'a saved UPI ID is never claimed as verified',
    upi.status === 'PENDING' && Boolean(upi.failure_reason),
    upi.status,
  );

  const upiList = (await call('GET', 'payments/upi-accounts', {}, token)).data;
  check('saved UPI IDs are listed', upiList.length === 1, String(upiList.length));

  await expectFault(
    'a malformed UPI ID is refused',
    () => call('POST', 'payments/upi-accounts', { vpa: 'nohandle', holder_name: 'Demo Account' }, token),
    'VALIDATION_ERROR',
  );
  await expectFault(
    "somebody else's name is refused",
    () => call('POST', 'payments/upi-accounts', { vpa: 'other@ybl', holder_name: 'Rahul Verma' }, token),
    'VALIDATION_ERROR',
  );

  const bank = (
    await call('POST', 'payments/bank-accounts', { account_number: '123456789012', ifsc: 'SBIN0001234', holder_name: 'Demo Account' }, token)
  ).data;
  check('a bank account can be saved', bank.account_last4 === '9012', bank.account_last4);
  check('a saved bank account is not claimed as verified', bank.status === 'PENDING', bank.status);

  await expectFault(
    'a malformed IFSC is refused',
    () => call('POST', 'payments/bank-accounts', { account_number: '123456789012', ifsc: 'SBIN1001234', holder_name: 'Demo Account' }, token),
    'VALIDATION_ERROR',
  );

  await expectFault(
    'withdrawing to a destination refuses rather than pretending',
    () => call('POST', 'payments/payouts', { amount: '500.00', upi_account_id: upi.id }, token),
    'PAYMENTS_NOT_ENABLED',
  );
  await expectFault(
    'UPI top-up refuses rather than pretending',
    () => call('POST', 'payments/top-up', { amount: '500.00' }, token),
    'PAYMENTS_NOT_ENABLED',
  );

  await assertLedgerBalanced('ledger still balanced at the end');
  await assertConservation('conservation holds at the end');

  console.log('\n=== ' + passed + ' passed, ' + failed + ' failed ===\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nHARNESS CRASHED:', error);
  process.exit(1);
});
