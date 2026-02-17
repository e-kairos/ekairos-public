"use client"
import { createContext, useContext } from "react"

const ThemeContext = createContext<any>({ theme: "light" })

export const useTheme = () => useContext(ThemeContext)

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => (
  <ThemeContext.Provider value={{ theme: "light" }}>
    {children}
  </ThemeContext.Provider>
)


