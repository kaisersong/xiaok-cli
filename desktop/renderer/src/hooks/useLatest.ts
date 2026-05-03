import { useRef, useEffect } from 'react'

export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => { ref.current = value })
  return ref
}
