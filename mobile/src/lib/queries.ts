/**
 * Server state.
 *
 * Every read goes through TanStack Query, and every mutation that moves money
 * invalidates the wallet, the project and the notification badge together —
 * because a release changes all three at once, and a screen showing two of the
 * three is a screen that lies.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api, newIdempotencyKey } from './api';

import type { Milestone, Project, Transaction, TrustScoreData } from '@/components/product';

/* ------------------------------------------------------------------- keys */

export const keys = {
  wallet: ['wallet'] as const,
  transactions: ['wallet', 'transactions'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  projectAnalysis: (id: string) => ['projects', id, 'analysis'] as const,
  milestone: (id: string) => ['milestones', id] as const,
  submissions: (id: string) => ['milestones', id, 'submissions'] as const,
  notifications: ['notifications'] as const,
  trustScore: ['trust-score'] as const,
  trustExplanation: ['trust-score', 'explanation'] as const,
  aiStatus: ['ai', 'status'] as const,
  disputes: ['disputes'] as const,
  dispute: (id: string) => ['disputes', id] as const,
  cancellation: (id: string) => ['cancellations', id] as const,
};

/** Everything a money movement can affect. */
function invalidateMoney(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: keys.wallet });
  client.invalidateQueries({ queryKey: keys.transactions });
  client.invalidateQueries({ queryKey: keys.projects });
  client.invalidateQueries({ queryKey: keys.notifications });
  client.invalidateQueries({ queryKey: keys.trustScore });
}

/* ----------------------------------------------------------------- wallet */

export type Wallet = {
  wallet_id: string;
  currency: string;
  available: string;
  protected: string;
  pending_settlement: string;
  total: string;
  is_frozen: boolean;
  kyc_verified: boolean;
  demo_mode: boolean;
};

export function useWallet() {
  return useQuery({
    queryKey: keys.wallet,
    queryFn: async () => (await api.get<Wallet>('/wallet')).data,
  });
}

export function useTransactions(limit = 20) {
  return useQuery({
    queryKey: [...keys.transactions, limit],
    queryFn: async () =>
      (
        await api.get<{ items: Transaction[]; total: number }>(
          `/wallet/transactions?limit=${limit}`,
        )
      ).data,
  });
}

export function useTopUp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (amount: string) =>
      (
        await api.post<Wallet>('/wallet/top-up', {
          amount,
          idempotency_key: newIdempotencyKey('topup'),
        })
      ).data,
    onSuccess: () => invalidateMoney(client),
  });
}

export function useWithdraw() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (amount: string) =>
      (
        await api.post<Wallet>('/wallet/withdraw', {
          amount,
          idempotency_key: newIdempotencyKey('withdraw'),
        })
      ).data,
    onSuccess: () => invalidateMoney(client),
  });
}

/* --------------------------------------------------------------- projects */

export type ProjectDetail = Project & {
  description: string;
  milestones: Milestone[];
  agreement_text: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  client: { id: string; full_name: string; email: string };
  receiver: { id: string; full_name: string; email: string } | null;
  /** Set when the receiver was invited by email but has not signed up yet. */
  invited_receiver_email: string | null;
};

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: async () =>
      (await api.get<{ items: Project[]; total: number }>('/projects')).data,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: async () => (await api.get<ProjectDetail>(`/projects/${id}`)).data,
    enabled: Boolean(id),
  });
}

export type AgreementAnalysis = {
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  findings: {
    severity: string;
    area: string;
    issue: string;
    recommendation: string;
    milestone_sequence: number | null;
  }[];
  strengths: string[];
  suggested_rewrites: {
    milestone_sequence: number;
    original: string;
    improved: string;
  }[];
  engine: 'claude' | 'rules';
  model: string | null;
  disclaimer: string;
};

export function useProjectAnalysis(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.projectAnalysis(id),
    queryFn: async () =>
      (await api.get<AgreementAnalysis>(`/projects/${id}/analysis`)).data,
    enabled: Boolean(id) && enabled,
    // The analysis only changes when the agreement does, which it cannot after
    // acceptance. No point refetching it on every focus.
    staleTime: 5 * 60_000,
  });
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: unknown) =>
      (await api.post<ProjectDetail>('/projects', payload)).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useInviteReceiver(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (receiverEmail: string) =>
      (
        await api.post<ProjectDetail>(`/projects/${projectId}/invite`, {
          receiver_email: receiverEmail,
        })
      ).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.project(projectId) });
      client.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useRespondToInvitation(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accept: boolean) =>
      (
        await api.post<ProjectDetail>(
          `/projects/${projectId}/${accept ? 'accept' : 'decline'}`,
        )
      ).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.project(projectId) });
      client.invalidateQueries({ queryKey: keys.projects });
      client.invalidateQueries({ queryKey: keys.notifications });
    },
  });
}

/* -------------------------------------------------------------- milestones */

export function useMilestone(id: string) {
  return useQuery({
    queryKey: keys.milestone(id),
    queryFn: async () => (await api.get<Milestone>(`/milestones/${id}`)).data,
    enabled: Boolean(id),
  });
}

export type Submission = {
  id: string;
  attempt: number;
  note: string;
  completion_percentage: number;
  evidence: { type?: string; url?: string; label?: string }[];
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export function useSubmissions(milestoneId: string) {
  return useQuery({
    queryKey: keys.submissions(milestoneId),
    queryFn: async () =>
      (await api.get<Submission[]>(`/milestones/${milestoneId}/submissions`)).data,
    enabled: Boolean(milestoneId),
  });
}

function useMilestoneMutation<TInput>(
  milestoneId: string,
  action: string,
  buildBody?: (input: TInput) => unknown,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) =>
      (
        await api.post<Milestone>(
          `/milestones/${milestoneId}/${action}`,
          buildBody ? buildBody(input) : {},
        )
      ).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.milestone(milestoneId) });
      client.invalidateQueries({ queryKey: keys.submissions(milestoneId) });
      invalidateMoney(client);
    },
  });
}

export function useFundMilestone(milestoneId: string) {
  return useMilestoneMutation<void>(milestoneId, 'fund', () => ({
    idempotency_key: newIdempotencyKey('fund'),
  }));
}

export function useApproveMilestone(milestoneId: string) {
  return useMilestoneMutation<void>(milestoneId, 'approve', () => ({
    idempotency_key: newIdempotencyKey('release'),
  }));
}

export function useSubmitMilestone(milestoneId: string) {
  return useMilestoneMutation<{
    note: string;
    completion_percentage: number;
    evidence: unknown[];
  }>(milestoneId, 'submit', (input) => input);
}

export function useRequestChanges(milestoneId: string) {
  return useMilestoneMutation<{ note: string }>(
    milestoneId,
    'request-changes',
    (input) => input,
  );
}

/* ------------------------------------------------------------ cancellation */

export type CancellationRequest = {
  id: string;
  milestone_id: string;
  project_id: string;
  status: string;
  reason: string;
  requested_by_id: string;
  counterparty_id: string;
  code_sent_to: string | null;
  decline_reason: string | null;
  demo_mode: boolean;
};

export function useRequestCancellation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { milestone_id: string; reason: string }) =>
      (await api.post<CancellationRequest>('/cancellations', input)).data,
    onSuccess: () => invalidateMoney(client),
  });
}

export function useCancellation(id: string) {
  return useQuery({
    queryKey: keys.cancellation(id),
    queryFn: async () =>
      (await api.get<CancellationRequest>(`/cancellations/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useVerifyCancellation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      (await api.post<CancellationRequest>(`/cancellations/${id}/verify`, { code }))
        .data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.cancellation(id) });
      invalidateMoney(client);
    },
  });
}

export function useDeclineCancellation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (reason: string) =>
      (
        await api.post<CancellationRequest>(`/cancellations/${id}/decline`, {
          reason,
        })
      ).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.cancellation(id) });
      invalidateMoney(client);
    },
  });
}

/* ----------------------------------------------------------------- disputes */

export type Dispute = {
  id: string;
  milestone_id: string;
  project_id: string;
  raised_by_id: string;
  against_id: string;
  reason: string;
  description: string;
  status: string;
  outcome: string | null;
  resolution_note: string | null;
  ai_summary: Record<string, unknown> | null;
  created_at: string;
  messages: {
    id: string;
    author_id: string;
    author_role: string;
    body: string;
    created_at: string;
  }[];
};

export function useDisputes() {
  return useQuery({
    queryKey: keys.disputes,
    queryFn: async () => (await api.get<Dispute[]>('/disputes')).data,
  });
}

export function useDispute(id: string) {
  return useQuery({
    queryKey: keys.dispute(id),
    queryFn: async () => (await api.get<Dispute>(`/disputes/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useRaiseDispute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      milestone_id: string;
      reason: string;
      description: string;
    }) => (await api.post<Dispute>('/disputes', input)).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.disputes });
      invalidateMoney(client);
    },
  });
}

export function useDisputeAiSummary(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<Record<string, unknown>>(`/disputes/${id}/ai-summary`)).data,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dispute(id) }),
  });
}

/* ------------------------------------------------------------ notifications */

export type Notification = {
  id: string;
  notification_type: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string;
  target: { screen?: string; id?: string };
  is_read: boolean;
  created_at: string;
};

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: async () =>
      (await api.get<{ items: Notification[]; unread: number }>('/notifications'))
        .data,
    // The unread badge is the app's most time-sensitive number.
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/notifications/${id}/read`)).data,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post('/notifications/read-all')).data,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}

/* --------------------------------------------------------------- AI / trust */

export function useTrustScore() {
  return useQuery({
    queryKey: keys.trustScore,
    queryFn: async () => (await api.get<TrustScoreData>('/ai/trust-score')).data,
  });
}

export type TrustExplanation = TrustScoreData & {
  /** Claude's plain-language reading of the score. Null when unavailable. */
  narrative: string | null;
  features: Record<string, number>;
  contributions: Record<string, number>;
  model_info: {
    model_version: string;
    model_type: string;
    explainability: string;
    metrics: Record<string, number>;
    trained_on: string;
  };
};

export function useTrustExplanation() {
  return useQuery({
    queryKey: keys.trustExplanation,
    queryFn: async () =>
      (await api.get<TrustExplanation>('/ai/trust-score/explanation')).data,
  });
}

export type AiStatus = {
  engine: 'claude' | 'rules';
  model: string | null;
  claude_connected: boolean;
  note: string;
  trust_score_model: {
    model_version: string;
    model_type: string;
    explainability: string;
    metrics: Record<string, number>;
    trained_on: string;
  };
};

/** Which engine is answering — shown in the UI so an AI claim is never implied
 *  when the built-in checks actually produced the answer. */
export function useAiStatus() {
  return useQuery({
    queryKey: keys.aiStatus,
    queryFn: async () => (await api.get<AiStatus>('/ai/status')).data,
    staleTime: 5 * 60_000,
  });
}

export function useAssistant() {
  return useMutation({
    mutationFn: async (question: string) =>
      (
        await api.post<{
          answer: string;
          sources: string[];
          disclaimer: string;
          engine: 'claude' | 'rules';
        }>('/ai/assistant', { question })
      ).data,
  });
}
