export type SystemId = 'light' | 'plus' | 'pro' | 'original'

export type SystemOption = {
  id: SystemId
  variant: string
  productName?: string
  logoSrc: string
  /** Exibe só a imagem da logo (sem badge WMS) */
  logoOnly?: boolean
  /** null = permanece neste app (WMS Light) */
  url: string | null
}

const PRODUCTION_URLS = {
  plus: 'https://wms.docalivre.com.br/',
  pro: 'https://doca-livre-wms-pro.onrender.com/',
  original: 'https://sistema.docalivre.com.br/login',
} as const

function envUrl(key: string): string | undefined {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function getSystemOptions(): SystemOption[] {
  return [
    {
      id: 'light',
      variant: 'Light',
      productName: 'WMS',
      logoSrc: '/systems/logo-wms-light.png',
      url: null,
    },
    {
      id: 'plus',
      variant: 'Plus',
      productName: 'WMS',
      logoSrc: '/systems/logo-wms-plus.png',
      url: envUrl('VITE_WMS_PLUS_URL') ?? PRODUCTION_URLS.plus,
    },
    {
      id: 'pro',
      variant: 'Pro',
      productName: 'WMS',
      logoSrc: '/systems/logo-wms-pro.png',
      url: envUrl('VITE_WMS_PRO_URL') ?? PRODUCTION_URLS.pro,
    },
    {
      id: 'original',
      variant: 'Original',
      logoSrc: '/systems/logo-original.png',
      logoOnly: true,
      url: envUrl('VITE_WMS_ORIGINAL_URL') ?? PRODUCTION_URLS.original,
    },
  ]
}

export function getSystemById(id: SystemId): SystemOption | undefined {
  return getSystemOptions().find((s) => s.id === id)
}
