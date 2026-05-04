import type { DesktopConfig } from '../shared/desktop'
import { ConnectionSettingsContent } from '../ConnectionSettingsContent'

type Props = {
  initialConfig?: DesktopConfig | null
}

export function ConnectionSettings({ initialConfig }: Props) {
  return <ConnectionSettingsContent initialConfig={initialConfig} />
}
