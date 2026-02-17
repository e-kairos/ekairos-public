"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Moon, Sun, Menu } from "lucide-react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { registryData } from "@/lib/ui-registry"
import { cn } from "@/lib/utils"
import { EkairosLogo } from "@/components/ekairos/ekairos-logo"

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isDark, setIsDark] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark")
    setIsDark(isDarkMode)
  }, [])

  const toggleTheme = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    if (newIsDark) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }

  const isComponentActive = (itemId: string) => pathname === `/docs/components/${itemId}`
  const isLinkActive = (href: string) => pathname === href

  const libraryLinks = [
    { label: "ekairos lib", href: "/docs/library/ekairos-lib" },
  ]

  return (
    <TooltipProvider>
      <div className="min-h-screen flex bg-background text-foreground overflow-hidden">
        {/* Mobile Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border/80 flex-shrink-0 flex flex-col transform transition-transform duration-300 lg:relative lg:translate-x-0",
          !isSidebarOpen && "-translate-x-full lg:hidden"
        )}>
          <div className="p-4 border-b border-border/80 flex items-center justify-between">
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← registry
            </Link>
            <button
              onClick={toggleTheme}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              title="Toggle theme"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 px-2 font-semibold">core</div>
              <div className="space-y-1">
                {registryData.filter(i => i.category === "core").map(item => (
                  <Link
                    key={item.id}
                    href={`/docs/components/${item.id}`}
                    className={cn(
                      "block px-3 py-1.5 text-sm transition-colors rounded-md",
                      isComponentActive(item.id)
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    {item.title.toLowerCase()}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 px-2 font-semibold">compound</div>
              <div className="space-y-1">
                {registryData.filter(i => i.category === "compound").map(item => (
                  <Link
                    key={item.id}
                    href={`/docs/components/${item.id}`}
                    className={cn(
                      "block px-3 py-1.5 text-sm transition-colors rounded-md",
                      isComponentActive(item.id)
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    {item.title.toLowerCase()}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 px-2 font-semibold">template</div>
              <div className="space-y-1">
                {registryData.filter(i => i.category === "template").map(item => (
                  <Link
                    key={item.id}
                    href={`/docs/components/${item.id}`}
                    className={cn(
                      "block px-3 py-1.5 text-sm transition-colors rounded-md",
                      isComponentActive(item.id)
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    {item.title.toLowerCase()}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 px-2 font-semibold">
                library
              </div>
              <div className="space-y-1">
                {libraryLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "block px-3 py-1.5 text-sm transition-colors rounded-md",
                      isLinkActive(link.href)
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <header className={cn(
            "h-14 border-b px-4 flex items-center gap-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 fixed top-0 right-0 left-0 z-40 transition-all duration-300",
            isSidebarOpen && "lg:left-64"
          )}>
             <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 hover:bg-accent rounded-md -ml-2 text-muted-foreground hover:text-foreground"
             >
                <Menu className="size-5" />
             </button>
             <EkairosLogo size="sm" />
          </header>

          <div className="flex-1 overflow-auto pt-14">
            <div className="max-w-3xl mx-auto p-8 space-y-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
