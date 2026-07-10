type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>
  }
}

export const isChromiumBrowser = () => {
  const nav = navigator as NavigatorWithUserAgentData
  const brands = nav.userAgentData?.brands?.map(({ brand }) => brand.toLowerCase()) ?? []

  if (brands.some((brand) => brand.includes('chromium') || brand.includes('google chrome'))) {
    return true
  }

  const userAgent = navigator.userAgent
  const isFirefox = /Firefox|FxiOS/i.test(userAgent)
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Opera/i.test(userAgent)

  return /Chrome|Chromium|CriOS|Edg|OPR|Opera/i.test(userAgent) && !isFirefox && !isSafari
}
