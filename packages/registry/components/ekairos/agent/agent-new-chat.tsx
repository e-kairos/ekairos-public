"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgentNewChatProps {
  onNewChat: () => void
  className?: string
  label?: string
}

export function AgentNewChat({ onNewChat, className, label = "Nuevo Chat" }: AgentNewChatProps) {
  return (
    <Button 
      variant="outline" 
      className={cn("gap-2", className)} 
      onClick={onNewChat}
    >
      <PlusIcon className="h-4 w-4" />
      {label}
    </Button>
  )
}




