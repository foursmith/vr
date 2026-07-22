import appPackage from "../../package.json"

export const APP_VERSION = __FSVR_VERSION__
export const APP_VERSION_URL = APP_VERSION.startsWith("v")
  ? `${appPackage.homepage}/releases/tag/${APP_VERSION}`
  : `${appPackage.homepage}/commit/${APP_VERSION}`
