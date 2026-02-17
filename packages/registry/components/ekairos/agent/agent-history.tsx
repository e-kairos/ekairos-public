"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MessageSquare, Trash2, History } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "./Agent"
import type { AgentHistoryItem } from "./Agent"

interface AgentHistoryProps {
  history: AgentHistoryItem[]
  selectedContextId?: string | null
  onHistorySelect: (contextId: string) => void
  onDeleteChat?: (contextId: string) => void
  className?: string
}

export function AgentHistory({ 
  history, 
  selectedContextId, 
  onHistorySelect, 
  onDeleteChat,
  className 
}: AgentHistoryProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-9 w-9", className)} title="Historial">
          <History className="h-4 w-4" />
          <span className="sr-only">Historial</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b bg-muted/50">
          <h4 className="font-medium text-sm">Historial de Chats</h4>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
          {history.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No hay chats recientes
            </div>
          ) : (
            history.map((item) => (
              <div 
                key={item.id}
                className={cn(
                  "group flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent/50 transition-colors text-sm",
                  selectedContextId === item.id ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                )}
                onClick={() => onHistorySelect(item.id)}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{item.title || "Nuevo Chat"}</div>
                  <div className="text-[10px] opacity-70 truncate">
                    {formatRelativeTime(item.createdAt)}
                  </div>
                </div>
                {onDeleteChat && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteChat(item.id)
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}




