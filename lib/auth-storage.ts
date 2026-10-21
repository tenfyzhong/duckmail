import type { Account, AuthState } from "@/types"

export const EMPTY_AUTH_STATE: AuthState = {
  token: null, currentAccount: null, accounts: [], isAuthenticated: false,
}

export function restoreAuthState(savedAuth: string | null): AuthState {
  if (!savedAuth) return EMPTY_AUTH_STATE
  const parsedAuth = JSON.parse(savedAuth)
  return {
    ...parsedAuth,
    accounts: parsedAuth.accounts?.map((account: Account) => ({
      ...account, providerId: account.providerId || "duckmail",
    })) || [],
    currentAccount: parsedAuth.currentAccount ? {
      ...parsedAuth.currentAccount,
      providerId: parsedAuth.currentAccount.providerId || "duckmail",
    } : null,
  }
}

export function shouldPersistAuth(authState: AuthState): boolean {
  return !!(authState.accounts.length > 0 || authState.currentAccount || authState.token)
}
