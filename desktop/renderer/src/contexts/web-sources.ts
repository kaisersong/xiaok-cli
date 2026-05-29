import { createContext } from 'react'
import type { WebSource } from '../storage'

export const WebSourcesContext = createContext<WebSource[]>([])
