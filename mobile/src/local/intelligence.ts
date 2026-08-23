/**
 * The on-device intelligence: trust scoring, agreement review, the assistant.
 *
 * The server version of this called Claude and fell back to deterministic rules
 * when the model was unavailable. Offline there is no model to call, so only
 * the rules half survives - and every response here reports `engine: 'rules'`
 * so the UI's engine badge keeps telling the truth. Labelling this output as AI
 * would be the easy lie; the screens were built to show which engine answered
 * precisely so that lie is never needed.
 *
 * The trust score is a linear scorecard rather than a trained model. That is a
 * real downgrade from the fitted logistic regression the backend used, and it
 * is stated in `model_info` rather than dressed up. What it keeps is the part
 * that mattered most: every point of the score is attributable to a named
 * feature, because for a linear model the exact contribution of each feature is
 * just its weight times its distance from the baseline.
 */

import type { Database, LocalMilestone, LocalProject } from './core';
import { balanceOf, accountFor } from './core';

/* ------------------------------------------------------------ trust score */

export type Features = {
  completed_milestones: number;
  on_time_rate: number;
  disputes_against: number;
  cancellations: number;
  account_age_days: number;
  funded_volume_rupees: number;
};

/**
 * Weights are points of score per unit of feature, and the baseline is the
 * "unremarkable new account" each feature is measured against. Keeping both
 * explicit is what makes the explanation screen honest: the numbers it shows
 * are the actual arithmetic, not a narrative written around a score.
 */
const WEIGHTS: Record<keyof Features, number> = {
  completed_milestones: 3.2,
  on_time_rate: 18.0,
  disputes_against: -11.0,
  cancellations: -5.5,
  account_age_days: 0.06,
  funded_volume_rupees: 0.0004,
};

const BASELINE: Record<keyof Features, number> = {
  completed_milestones: 2,
  on_time_rate: 0.8,
  disputes_against: 0,
  cancellations: 0,
  account_age_days: 30,
  funded_volume_rupees: 20000,
};

const BASE_SCORE = 62;

export function extractFeatures(db: Database, userId: string): Features {
  const projects = db.projects.filter(
    (project) => project.client_id === userId || project.receiver_id === userId,
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const milestones = db.milestones.filter((milestone) =>
    projectIds.has(milestone.project_id),
  );

  const released = milestones.filter(
    (milestone) => milestone.status === 'RELEASED',
  );

  const onTime = released.filter((milestone) => {
    if (!milestone.due_date || !milestone.released_at) return true;
    return new Date(milestone.released_at) <= new Date(milestone.due_date);
  });

  const fundedPaise = db.transactions
    .filter((transaction) => transaction.transaction_type === 'MILESTONE_FUNDING')
    .reduce((sum, transaction) => {
      const legs = db.postings.filter(
        (posting) => posting.transaction_id === transaction.id,
      );
      return sum + legs.reduce((s, leg) => s + Math.max(leg.amount, 0), 0);
    }, 0);

  const user = db.users.find((candidate) => candidate.id === userId);
  const ageDays = user
    ? Math.max(
        0,
        (Date.now() - new Date(user.created_at).getTime()) / 86_400_000,
      )
    : 0;

  return {
    completed_milestones: released.length,
    on_time_rate: released.length ? onTime.length / released.length : 0.8,
    disputes_against: db.disputes.filter(
      (dispute) => dispute.against_id === userId,
    ).length,
    cancellations: db.cancellations.filter(
      (cancellation) =>
        cancellation.status === 'APPROVED' &&
        cancellation.requested_by_id === userId,
    ).length,
    account_age_days: ageDays,
    funded_volume_rupees: fundedPaise / 100,
  };
}

export function contributionsFor(features: Features): Record<string, number> {
  const contributions: Record<string, number> = {};
  for (const key of Object.keys(WEIGHTS) as (keyof Features)[]) {
    contributions[key] = WEIGHTS[key] * (features[key] - BASELINE[key]);
  }
  return contributions;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function scoreFrom(features: Features): number {
  const total = Object.values(contributionsFor(features)).reduce(
    (sum, value) => sum + value,
    0,
  );
  return Math.round(clamp(BASE_SCORE + total, 5, 99));
}

function bandFor(score: number): { band: string; label: string } {
  if (score >= 85) return { band: 'A', label: 'Excellent' };
  if (score >= 70) return { band: 'B', label: 'Good' };
  if (score >= 55) return { band: 'C', label: 'Fair' };
  if (score >= 40) return { band: 'D', label: 'Needs attention' };
  return { band: 'E', label: 'High risk' };
}

const FEATURE_LABELS: Record<keyof Features, string> = {
  completed_milestones: 'completed milestones',
  on_time_rate: 'on-time delivery',
  disputes_against: 'disputes raised against you',
  cancellations: 'cancellations you requested',
  account_age_days: 'account history',
  funded_volume_rupees: 'value protected through TrustPay',
};

export function trustScorePayload(db: Database, userId: string) {
  const features = extractFeatures(db, userId);
  const contributions = contributionsFor(features);
  const score = scoreFrom(features);
  const { band, label } = bandFor(score);

  const ranked = (Object.keys(contributions) as (keyof Features)[]).sort(
    (a, b) => Math.abs(contributions[b]) - Math.abs(contributions[a]),
  );

  const positive = ranked
    .filter((key) => contributions[key] > 0.5)
    .slice(0, 3)
    .map(
      (key) =>
        'Your ' +
        FEATURE_LABELS[key] +
        ' adds ' +
        contributions[key].toFixed(1) +
        ' points.',
    );

  const risk = ranked
    .filter((key) => contributions[key] < -0.5)
    .slice(0, 3)
    .map(
      (key) =>
        'Your ' +
        FEATURE_LABELS[key] +
        ' costs ' +
        Math.abs(contributions[key]).toFixed(1) +
        ' points.',
    );

  // Below a handful of finished milestones the score is mostly the base value,
  // and presenting it as a measurement of someone would be overclaiming.
  const thin = features.completed_milestones < 3;

  return {
    score,
    band,
    band_label: label,
    confidence: thin ? 'LOW' : features.completed_milestones < 8 ? 'MEDIUM' : 'HIGH',
    positive_reasons: positive.length
      ? positive
      : ['Nothing on your account is currently counting against you.'],
    risk_reasons: risk,
    delta: null,
    limited_data_notice: thin
      ? 'This score is mostly the starting value. It becomes meaningful once you have completed a few milestones.'
      : null,
    features: features as unknown as Record<string, number>,
    contributions,
  };
}

export const MODEL_INFO = {
  model_version: 'offline-scorecard-1.0',
  model_type: 'linear_scorecard',
  explainability: 'exact_contributions',
  metrics: {},
  trained_on:
    'Not trained. Offline builds score with a fixed linear scorecard rather than the fitted model the server used.',
};

/* ------------------------------------------------------ agreement analysis */

type Finding = {
  severity: string;
  area: string;
  issue: string;
  recommendation: string;
  milestone_sequence: number | null;
};

/**
 * Read an agreement the way a cautious reader would.
 *
 * These are the checks that catch the disputes people actually have: work that
 * nobody can prove is finished, a first payment large enough to hurt, and dates
 * that were never agreed. Each finding names the milestone it came from so the
 * screen can point at it.
 */
export function analyseAgreement(
  project: LocalProject,
  milestones: LocalMilestone[],
) {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const rewrites: {
    milestone_sequence: number;
    original: string;
    improved: string;
  }[] = [];

  const total = milestones.reduce((sum, milestone) => sum + milestone.amount, 0);

  const VAGUE = [
    'as discussed',
    'etc',
    'and so on',
    'to satisfaction',
    'as needed',
    'good quality',
    'professional',
    'asap',
  ];

  for (const milestone of milestones) {
    const criteria = (milestone.completion_criteria || '').trim();

    if (criteria.length < 25) {
      findings.push({
        severity: 'HIGH',
        area: 'Completion criteria',
        issue:
          'Milestone ' +
          milestone.sequence +
          ' does not say what finished looks like in enough detail to check.',
        recommendation:
          'Describe the deliverable so a third party could tell whether it was met - a file, a link, a working feature, a number.',
        milestone_sequence: milestone.sequence,
      });
      rewrites.push({
        milestone_sequence: milestone.sequence,
        original: criteria || '(empty)',
        improved:
          'Deliver ' +
          (milestone.title || 'the agreed work') +
          ' as a shared link or file, meeting the points listed in the description, with any revision requests raised within 5 days of submission.',
      });
    } else {
      const found = VAGUE.find((phrase) =>
        criteria.toLowerCase().includes(phrase),
      );
      if (found) {
        findings.push({
          severity: 'MEDIUM',
          area: 'Ambiguous wording',
          issue:
            'Milestone ' +
            milestone.sequence +
            ' relies on the phrase "' +
            found +
            '", which two people can read differently.',
          recommendation:
            'Replace it with something checkable. "Approved by the client" is a decision; "matches the attached spec" is a test.',
          milestone_sequence: milestone.sequence,
        });
      }
    }

    if (!milestone.due_date) {
      findings.push({
        severity: 'MEDIUM',
        area: 'Dates',
        issue: 'Milestone ' + milestone.sequence + ' has no due date.',
        recommendation:
          'Add one. Without a date, late is unprovable and the on-time record that feeds your Trust Score cannot be computed.',
        milestone_sequence: milestone.sequence,
      });
    }

    if (total > 0 && milestone.amount / total > 0.6 && milestones.length > 1) {
      findings.push({
        severity: 'HIGH',
        area: 'Payment balance',
        issue:
          'Milestone ' +
          milestone.sequence +
          ' carries ' +
          Math.round((milestone.amount / total) * 100) +
          '% of the total value.',
        recommendation:
          'Split it. Concentrating the money in one step removes most of the protection staged payments are for.',
        milestone_sequence: milestone.sequence,
      });
    }
  }

  if (milestones.length >= 3) {
    strengths.push(
      'The work is split across ' +
        milestones.length +
        ' milestones, so neither side is ever exposed for the full amount.',
    );
  }
  if (milestones.every((milestone) => milestone.due_date)) {
    strengths.push('Every milestone has a due date.');
  }
  if (
    milestones.every(
      (milestone) => (milestone.completion_criteria || '').trim().length >= 25,
    )
  ) {
    strengths.push('Each milestone states what counts as finished.');
  }
  if ((project.agreement_text || '').trim().length > 200) {
    strengths.push('The agreement is written out rather than assumed.');
  }

  const high = findings.filter((finding) => finding.severity === 'HIGH').length;
  const risk = high >= 2 ? 'HIGH' : high === 1 || findings.length >= 3 ? 'MEDIUM' : 'LOW';

  const summary =
    findings.length === 0
      ? 'Nothing in this agreement looks likely to cause an argument later. The milestones are specific, dated and proportionate.'
      : 'Found ' +
        findings.length +
        ' thing' +
        (findings.length === 1 ? '' : 's') +
        ' worth fixing before you start. ' +
        (high > 0
          ? 'At least one could leave you without a way to prove what was agreed.'
          : 'None are severe, but each is a common source of disputes.');

  return {
    risk_level: risk as 'LOW' | 'MEDIUM' | 'HIGH',
    summary,
    findings,
    strengths,
    suggested_rewrites: rewrites,
    engine: 'rules' as const,
    model: null,
    disclaimer:
      'These are automated checks running on your phone, not legal advice and not an AI review.',
  };
}

/* ---------------------------------------------------------------- assistant */

type Answer = { match: RegExp; answer: string; sources: string[] };

/**
 * The assistant, offline.
 *
 * A keyword-matched knowledge base, which is a smaller thing than the model the
 * online build talks to and is labelled as such. It answers what TrustPay
 * itself does; it declines anything else rather than inventing an answer, which
 * is the only responsible behaviour for a lookup table wearing a chat interface.
 */
const ANSWERS: Answer[] = [
  {
    match: /protect|escrow|hold|safe|secure/i,
    answer:
      'When you fund a milestone, that money leaves your available balance and sits in a protected balance. You cannot spend it and the receiver cannot draw it. It moves to them only when you approve the work, or back to you if the milestone is cancelled with their agreement.',
    sources: ['How protection works'],
  },
  {
    match: /cancel|refund|back out|withdraw the project/i,
    answer:
      'Cancelling a funded milestone needs the receiver to enter a code sent to them. This is deliberate: it stops a client pulling protected funds back the moment work has started. If they decline, the milestone stays funded and you can raise a dispute instead.',
    sources: ['Cancellation protection'],
  },
  {
    match: /dispute|disagree|argument|refuse/i,
    answer:
      'Either side can raise a dispute on a milestone. The funds stay protected while it is open - they cannot be released or refunded until it is resolved, so neither party can act unilaterally during the disagreement.',
    sources: ['Disputes'],
  },
  {
    match: /trust score|rating|score/i,
    answer:
      'Your Trust Score is built from your completed milestones, how often you delivered on time, disputes raised against you, cancellations you requested, how long you have been here, and the value you have protected. Every point is attributable to one of those - open the Trust Score screen to see the exact contribution of each.',
    sources: ['Trust Score'],
  },
  {
    match: /fee|charge|cost|commission/i,
    answer:
      'This build charges no fees. Amounts you see are the amounts that move.',
    sources: ['Fees'],
  },
  {
    match: /add money|top ?up|deposit|load/i,
    answer:
      'Add money from the wallet screen. This build is offline and in demo mode, so the funds are simulated - no real payment method is involved and nothing leaves a real account.',
    sources: ['Wallet'],
  },
  {
    match: /balance|hidden|biometric|pin|fingerprint|face/i,
    answer:
      'Balances stay masked until you unlock them with a fingerprint, face unlock or your PIN, and they re-lock after a minute or as soon as you leave the app. That protects the screen from someone glancing at your phone; it is not a lock on the account itself.',
    sources: ['Balance lock'],
  },
  {
    match: /milestone|stage|step|phase/i,
    answer:
      'A project is split into milestones, each with its own amount and its own definition of finished. Each one runs the same way: fund it, the receiver submits the work, you approve or request changes, and approval releases that milestone alone.',
    sources: ['Milestones'],
  },
  {
    match: /offline|internet|server|connect|wifi/i,
    answer:
      'This build runs entirely on your phone. There is no server and no network call, so it works with no internet and nothing to configure. The trade-off is that everything lives on this device: another person on another phone is not connected to your records, and the escrow is simulated rather than held by anyone.',
    sources: ['Offline build'],
  },
];

export function askAssistant(question: string) {
  const asked = (question || '').trim();

  const hit = ANSWERS.find((entry) => entry.match.test(asked));

  return {
    answer: hit
      ? hit.answer
      : 'I can only answer questions about how TrustPay works - protection, cancellations, disputes, milestones, the wallet and the Trust Score. This offline build answers from a small built-in reference rather than a language model, so I would rather say I do not know than guess.',
    sources: hit ? hit.sources : [],
    disclaimer:
      'Answered from a built-in reference on your device, not an AI model.',
    engine: 'rules' as const,
  };
}

/* ----------------------------------------------------------- dispute notes */

export function summariseDispute(
  db: Database,
  disputeId: string,
): Record<string, unknown> {
  const dispute = db.disputes.find((candidate) => candidate.id === disputeId);
  if (!dispute) return {};

  const milestone = db.milestones.find(
    (candidate) => candidate.id === dispute.milestone_id,
  );
  const protectedPaise = milestone ? milestone.amount : 0;

  const submissions = db.submissions.filter(
    (submission) => submission.milestone_id === dispute.milestone_id,
  );

  return {
    engine: 'rules',
    model: null,
    headline:
      'Milestone ' +
      (milestone ? milestone.sequence : '?') +
      ' is disputed with ' +
      (protectedPaise / 100).toFixed(2) +
      ' protected.',
    timeline: [
      'Raised ' + new Date(dispute.created_at).toDateString() + '.',
      submissions.length + ' submission' + (submissions.length === 1 ? '' : 's') + ' on record.',
      dispute.messages.length + ' message' + (dispute.messages.length === 1 ? '' : 's') + ' exchanged.',
    ],
    funds_status:
      'Protected and frozen. Nothing can be released or refunded while this dispute is open.',
    suggested_next_step:
      submissions.length === 0
        ? 'No work has been submitted against this milestone. Agreeing a cancellation is usually faster than arguing about delivery.'
        : 'Compare the latest submission against the milestone completion criteria, and say specifically which part is unmet.',
    disclaimer:
      'A summary of what is on file, produced by built-in checks rather than an AI model. It takes no side.',
  };
}

/* ------------------------------------------------------------ wallet totals */

export function walletTotals(db: Database, userId: string) {
  return {
    available: balanceOf(db, accountFor(db, userId, 'AVAILABLE').id),
    protectedAmount: balanceOf(db, accountFor(db, userId, 'PROTECTED').id),
    pending: balanceOf(db, accountFor(db, userId, 'PENDING').id),
  };
}
