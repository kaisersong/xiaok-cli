import { AuthPage as SharedAuthPage, type AuthApi } from '../shared'
import {
  login,
  register,
  getRegistrationMode,
  resolveIdentity,
  sendResolvedEmailOTP,
  verifyResolvedEmailOTP,
  getCaptchaConfig,
} from '../api'
import { useLocale } from '../contexts/LocaleContext'

const api: AuthApi = {
  login,
  getCaptchaConfig,
  resolveIdentity,
  getRegistrationMode,
  register,
  sendResolvedEmailOTP,
  verifyResolvedEmailOTP,
}

type Props = { onLoggedIn: (accessToken: string) => void }

export function AuthPage({ onLoggedIn }: Props) {
  const { t, locale } = useLocale()

  return (
    <SharedAuthPage
      onLoggedIn={onLoggedIn}
      brandLabel="Xiaok"
      locale={locale}
      t={t}
      api={api}
    />
  )
}
