import { createContext, useContext } from 'react'

export const HospitalContext = createContext(null)

export function useHospital() {
  return useContext(HospitalContext)
}

export function buildNavigationPayload(screen, params = {}) {
  return { screen, ...params }
}
