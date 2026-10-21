"use client"

import React, { createContext, useContext, type ReactNode } from "react"
import { useHydratedState } from "@/hooks/use-hydrated-state"
import type { ApiProvider, CustomApiProvider } from "@/types"

// 预设的API提供商
export const PRESET_PROVIDERS: ApiProvider[] = [
  {
    id: "duckmail",
    name: "DuckMail",
    baseUrl: "https://api.duckmail.sbs",
    mercureUrl: "https://mercure.duckmail.sbs/.well-known/mercure",
    isCustom: false,
  },
  {
    id: "mailtm",
    name: "Mail.tm",
    baseUrl: "https://api.mail.tm",
    mercureUrl: "https://mercure.mail.tm/.well-known/mercure",
    isCustom: false,
  },
]

interface ApiProviderContextType {
  providers: ApiProvider[]
  enabledProviders: ApiProvider[]
  disabledProviderIds: string[]
  addCustomProvider: (provider: CustomApiProvider) => void
  removeCustomProvider: (providerId: string) => void
  updateCustomProvider: (provider: CustomApiProvider) => void
  toggleProviderEnabled: (providerId: string) => void
  isProviderEnabled: (providerId: string) => boolean
  getProviderById: (providerId: string) => ApiProvider | undefined
  apiKey: string
  setApiKey: (apiKey: string) => void
}

const ApiProviderContext = createContext<ApiProviderContextType | undefined>(undefined)

interface ApiProviderProviderProps {
  children: ReactNode
}

const DEFAULT_CUSTOM_PROVIDERS: CustomApiProvider[] = []
const DEFAULT_DISABLED_PROVIDERS = ["mailtm"]

function restoreArray<T>(key: string, fallback: T[]): T[] {
  try {
    const saved = localStorage.getItem(key)
    const parsed = saved ? JSON.parse(saved) : fallback
    return Array.isArray(parsed) ? parsed : fallback
  } catch (error) {
    console.error("Error loading API provider settings:", error)
    return fallback
  }
}
const restoreCustomProviders = () => restoreArray("custom-api-providers", DEFAULT_CUSTOM_PROVIDERS)
const restoreDisabledProviders = () => restoreArray("disabled-api-providers", DEFAULT_DISABLED_PROVIDERS)
const restoreApiKey = () => {
  try {
    return localStorage.getItem("api-key") || ""
  } catch (error) {
    console.error("Error loading API key:", error)
    return ""
  }
}

export function ApiProviderProvider({ children }: ApiProviderProviderProps) {
  const [customProviders, setCustomProviders] = useHydratedState(DEFAULT_CUSTOM_PROVIDERS, restoreCustomProviders)
  // 默认禁用 mail.tm，用户可在设置中手动启用
  const [disabledProviderIds, setDisabledProviderIds] = useHydratedState(DEFAULT_DISABLED_PROVIDERS, restoreDisabledProviders)
  const [apiKey, setApiKeyState] = useHydratedState("", restoreApiKey)

  // 所有提供商（预设 + 自定义）
  const providers = [...PRESET_PROVIDERS, ...customProviders]

  // 启用的提供商
  const enabledProviders = providers.filter(provider =>
    !disabledProviderIds.includes(provider.id)
  )

  // 添加自定义提供商
  const addCustomProvider = (provider: CustomApiProvider) => {
    const newCustomProviders = [...customProviders, provider]
    setCustomProviders(newCustomProviders)
    localStorage.setItem("custom-api-providers", JSON.stringify(newCustomProviders))
  }

  // 删除自定义提供商
  const removeCustomProvider = (providerId: string) => {
    const newCustomProviders = customProviders.filter(p => p.id !== providerId)
    setCustomProviders(newCustomProviders)
    localStorage.setItem("custom-api-providers", JSON.stringify(newCustomProviders))
  }

  // 更新自定义提供商
  const updateCustomProvider = (provider: CustomApiProvider) => {
    const newCustomProviders = customProviders.map(p =>
      p.id === provider.id ? provider : p
    )
    setCustomProviders(newCustomProviders)
    localStorage.setItem("custom-api-providers", JSON.stringify(newCustomProviders))
  }

  // 切换提供商启用状态
  const toggleProviderEnabled = (providerId: string) => {
    const newDisabledIds = disabledProviderIds.includes(providerId)
      ? disabledProviderIds.filter(id => id !== providerId)
      : [...disabledProviderIds, providerId]

    setDisabledProviderIds(newDisabledIds)
    localStorage.setItem("disabled-api-providers", JSON.stringify(newDisabledIds))
  }

  // 检查提供商是否启用
  const isProviderEnabled = (providerId: string) => {
    return !disabledProviderIds.includes(providerId)
  }

  // 根据ID获取提供商
  const getProviderById = (providerId: string) => {
    return providers.find(p => p.id === providerId)
  }

  // 设置API Key
  const setApiKey = (newApiKey: string) => {
    console.log(`🔑 [Context] Setting API Key: ${newApiKey ? `${newApiKey.substring(0, 10)}...` : 'null'}`)
    setApiKeyState(newApiKey)
    localStorage.setItem("api-key", newApiKey)
  }

  const value: ApiProviderContextType = {
    providers,
    enabledProviders,
    disabledProviderIds,
    addCustomProvider,
    removeCustomProvider,
    updateCustomProvider,
    toggleProviderEnabled,
    isProviderEnabled,
    getProviderById,
    apiKey,
    setApiKey,
  }

  return (
    <ApiProviderContext.Provider value={value}>
      {children}
    </ApiProviderContext.Provider>
  )
}

export function useApiProvider() {
  const context = useContext(ApiProviderContext)
  if (context === undefined) {
    throw new Error("useApiProvider must be used within an ApiProviderProvider")
  }
  return context
}
