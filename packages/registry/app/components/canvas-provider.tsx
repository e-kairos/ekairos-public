"use client"
import { createContext, useContext } from "react"

const CanvasContext = createContext<any>({
  bridge: {
    addElements: async () => {}
  }
})

export const useCanvas = () => useContext(CanvasContext)

export const CanvasProvider = ({ children }: { children: React.ReactNode }) => (
  <CanvasContext.Provider value={{ bridge: { addElements: async () => {} } }}>
    {children}
  </CanvasContext.Provider>
)


