/**
 * Payments: adding money by UPI, and withdrawing to a bank account.
 *
 * The important behaviour here is what happens *after* a UPI app is opened.
 *
 * Nothing. Deliberately.
 *
 * Android hands control to GPay or PhonePe and, when the user comes back, tells
 * us only that they came back - not whether they paid. Treating the return as
 * success is the mistake that lets anyone top up for free by opening a UPI app
 * and pressing back. So the app polls its own server for the intent's status,
 * and the server only moves it to SUCCEEDED when the payment provider confirms
 * over a signed webhook.
 *
 * That is why "waiting for your bank to confirm" is a real state in this UI
 * rather than a spinner covering an instant local update.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Platform } from 'react-native';

import { api } from './api';
import { keys as walletKeys } from './queries';

export type PaymentsStatus = {
  collections_enabled: boolean;
  payouts_enabled: boolean;
  google_sign_in_enabled: boolean;
  merchant_vpa: string | null;
  minimum_payout: string;
  daily_payout_limit: string;
  note: string;
};

export type UpiTarget = {
  key: string;
  label: string;
  package: string;
  url: string;
};

export type PaymentIntent = {
  id: string;
  amount: string;
  currency: string;
  status: 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  reference: string;
  provider_order_id: string | null;
  razorpay_key_id: string | null;
  upi_targets: UpiTarget[];
  note: string;
};

export type BankAccount = {
  id: string;
  holder_name: string;
  bank_name: string;
  branch: string;
  ifsc: string;
  account_last4: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'FAILED';
  is_default: boolean;
  verified_at: string | null;
  failure_reason: string | null;
  name_match_score: number | null;
};

export type IfscLookup = {
  ifsc: string;
  bank: string;
  branch: string;
  city: string;
  state: string;
  supports_imps: boolean;
  supports_neft: boolean;
};

export type Payout = {
  id: string;
  amount: string;
  currency: string;
  status: 'REQUESTED' | 'PROCESSING' | 'PROCESSED' | 'REVERSED' | 'FAILED';
  reference: string;
  bank_account_id: string;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

export const paymentKeys = {
  status: ['payments', 'status'] as const,
  bankAccounts: ['payments', 'bank-accounts'] as const,
  payouts: ['payments', 'payouts'] as const,
  intent: (id: string) => ['payments', 'intent', id] as const,
};

/** What this deployment can actually do, so the UI never offers a dead button. */
export function usePaymentsStatus() {
  return useQuery({
    queryKey: paymentKeys.status,
    queryFn: async () => (await api.get<PaymentsStatus>('/payments/status')).data,
    staleTime: 5 * 60_000,
    // A deployment without payments is a normal state, not an error worth
    // retrying at users.
    retry: false,
  });
}

export function useIfscLookup() {
  return useMutation({
    mutationFn: async (ifsc: string) =>
      (await api.get<IfscLookup>(`/payments/ifsc/${ifsc.trim().toUpperCase()}`)).data,
  });
}

export function useBankAccounts() {
  return useQuery({
    queryKey: paymentKeys.bankAccounts,
    queryFn: async () => (await api.get<BankAccount[]>('/payments/bank-accounts')).data,
  });
}

export function useAddBankAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      account_number: string;
      ifsc: string;
      holder_name: string;
    }) => (await api.post<BankAccount>('/payments/bank-accounts', input)).data,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: paymentKeys.bankAccounts }),
  });
}

export function useStartTopUp() {
  return useMutation({
    mutationFn: async (amount: string) =>
      (await api.post<PaymentIntent>('/payments/top-up', { amount })).data,
  });
}

export function usePayouts() {
  return useQuery({
    queryKey: paymentKeys.payouts,
    queryFn: async () => (await api.get<Payout[]>('/payments/payouts')).data,
  });
}

export function useRequestPayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { amount: string; bank_account_id: string }) =>
      (await api.post<Payout>('/payments/payouts', input)).data,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: paymentKeys.payouts });
      client.invalidateQueries({ queryKey: walletKeys.wallet });
      client.invalidateQueries({ queryKey: walletKeys.transactions });
    },
  });
}

/**
 * Open a UPI app with the payment pre-filled.
 *
 * Returns whether an app opened - not whether anything was paid. The caller
 * must go on to watch the intent's status; there is no shortcut.
 */
export async function openUpiApp(target: UpiTarget): Promise<boolean> {
  if (Platform.OS !== 'android') {
    // The intent scheme is Android's. On iOS these are per-app universal links
    // and each wallet needs its own registration, which this build does not have.
    return false;
  }

  try {
    const supported = await Linking.canOpenURL(target.url);
    if (!supported) return false;
    await Linking.openURL(target.url);
    return true;
  } catch {
    return false;
  }
}

/** Which UPI apps are actually installed, so we only offer those. */
export async function installedUpiApps(targets: UpiTarget[]): Promise<UpiTarget[]> {
  if (Platform.OS !== 'android') return [];

  const checks = await Promise.all(
    targets.map(async (target) => {
      try {
        return (await Linking.canOpenURL(target.url)) ? target : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((target): target is UpiTarget => target !== null);
}
