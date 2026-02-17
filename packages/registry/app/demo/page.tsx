"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  Sparkles, 
  Code2, 
  Layout, 
  Menu, 
  Moon, 
  Sun, 
  Copy, 
  Terminal,
  Box
} from "lucide-react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { registryData, type RegistryItem } from "@/lib/ui-registry"

// --- UI COMPONENTS FOR DOCS ---

const TabButton = ({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={cn(
      "px-4 py-2 text-sm font-medium transition-all border-b-2",
      active 
        ? "border-primary text-primary" 
        : "border-transparent text-muted-foreground hover:text-foreground"
    )}
  >
    {children}
  </button>
)

const ComponentViewer = ({ item }: { item: RegistryItem }) => {
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview")

  return (
    <div className="space-y-6 animate-in fade-in duration-500 slide-in-from-bottom-4">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          {item.title}
          <span className="text-xs font-normal px-2 py-1 rounded-full bg-muted text-muted-foreground border uppercase tracking-wider">
            {item.category}
          </span>
        </h2>
        <p className="text-lg text-muted-foreground mt-2">{item.subtitle}</p>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b">
        <TabButton active={activeTab === "preview"} onClick={() => setActiveTab("preview")}>
          Preview
        </TabButton>
        <TabButton active={activeTab === "code"} onClick={() => setActiveTab("code")}>
          Code
        </TabButton>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "preview" ? (
          <div className="p-8 border rounded-xl bg-muted/5 dark:bg-black/20 flex items-center justify-center min-h-[400px] relative overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
            <div className="relative w-full z-10 flex justify-center">
              {item.render()}
            </div>
          </div>
        ) : (
          <div className="relative rounded-xl border bg-muted p-4 min-h-[400px]">
            <div className="absolute right-4 top-4">
                <button className="p-2 hover:bg-background rounded-md transition-colors" title="Copy code">
                    <Copy className="size-4 text-muted-foreground" />
                </button>
            </div>
            <pre className="overflow-x-auto text-sm font-mono text-foreground p-4">
              <code>{item.code}</code>
            </pre>
          </div>
        )}
      </div>

      {/* Props Table */}
      {item.props && item.props.length > 0 && (
        <div className="space-y-4 pt-8">
          <h3 className="text-xl font-semibold">API Reference</h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-4 font-medium text-muted-foreground">Prop</th>
                  <th className="p-4 font-medium text-muted-foreground">Type</th>
                  <th className="p-4 font-medium text-muted-foreground">Default</th>
                  <th className="p-4 font-medium text-muted-foreground">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {item.props.map((prop) => (
                  <tr key={prop.name} className="hover:bg-muted/50">
                    <td className="p-4 font-mono text-primary">{prop.name}</td>
                    <td className="p-4 font-mono text-xs text-pink-500">{prop.type}</td>
                    <td className="p-4 font-mono text-xs text-muted-foreground">{prop.default}</td>
                    <td className="p-4 text-muted-foreground">{prop.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// --- MAIN PAGE LAYOUT ---

export default function DemoPage() {
  const pathname = usePathname()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  
  // Theme Toggle Logic
  const [isDark, setIsDark] = useState(false)
  const toggleTheme = () => {
    setIsDark(!isDark)
    if (!isDark) document.documentElement.classList.add("dark")
    else document.documentElement.classList.remove("dark")
  }

  // Get active item from pathname or default to first item
  const activeId = pathname?.includes("/docs/components/") 
    ? pathname.split("/docs/components/")[1]?.split("/")[0] || "message"
    : "message"
  const activeItem = registryData.find(item => item.id === activeId) || registryData[0]

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground flex overflow-hidden transition-colors duration-300">
        
        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform duration-300 lg:relative lg:translate-x-0",
          !isSidebarOpen && "-translate-x-full lg:hidden"
        )}>
          <div className="h-full flex flex-col">
            <div className="h-16 border-b flex items-center px-6 gap-2">
              <Sparkles className="size-5 text-primary" />
              <span className="font-bold text-lg tracking-tight">Ekairos UI</span>
            </div>
            
            <div className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
              <div>
                <h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Core Components</h4>
                <nav className="space-y-1">
                  {registryData.filter(i => i.category === "core").map(item => (
                    <Link
                      key={item.id}
                      href={`/docs/components/${item.id}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                        "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Box className="size-4" />
                      {item.title}
                    </Link>
                  ))}
                </nav>
              </div>

              <div>
                <h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Compounds</h4>
                <nav className="space-y-1">
                  {registryData.filter(i => i.category === "compound").map(item => (
                    <Link
                      key={item.id}
                      href={`/docs/components/${item.id}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                        "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Code2 className="size-4" />
                      {item.title}
                    </Link>
                  ))}
                </nav>
              </div>

              <div>
                <h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Templates</h4>
                <nav className="space-y-1">
                  {registryData.filter(i => i.category === "template").map(item => (
                    <Link
                      key={item.id}
                      href={`/docs/components/${item.id}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                        "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Layout className="size-4" />
                      {item.title}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>

            <div className="p-4 border-t">
              <div className="text-xs text-muted-foreground text-center">
                v1.0.0-alpha
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          
          {/* Mobile Header & Toolbar */}
          <header className="h-16 border-b flex items-center justify-between px-4 lg:px-8 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="lg:hidden p-2 hover:bg-muted rounded-md"
            >
              <Menu className="size-5" />
            </button>

            <div className="flex items-center gap-4 ml-auto">
               <a 
                href="https://github.com" 
                target="_blank" 
                rel="noreferrer"
                className="text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2"
              >
                <Terminal className="size-4" />
                Documentation
              </a>
              <div className="h-4 w-px bg-border mx-2"></div>
              <button 
                onClick={toggleTheme}
                className="p-2 rounded-full hover:bg-muted transition-colors"
                title="Toggle Theme"
              >
                {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
              </button>
            </div>
          </header>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-auto p-4 lg:p-12">
            <div className="max-w-5xl mx-auto">
               <div className="mb-8 pb-8 border-b">
                 <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4">
                   Ekairos Registry
                 </h1>
                 <p className="text-xl text-muted-foreground">
                   Beautifully designed components for building AI-powered interfaces.
                   Accessible. Customizable. Open Source.
                 </p>
               </div>
               
               <ComponentViewer item={activeItem} />
            </div>
          </div>

        </main>
      </div>
    </TooltipProvider>
  )
}
