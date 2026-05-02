"use client";

import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ContextNewButtonProps = {
  onNewContext: () => void;
  className?: string;
  label?: string;
};

export function ContextNewButton({
  onNewContext,
  className,
  label = "Nuevo contexto",
}: ContextNewButtonProps) {
  return (
    <Button
      variant="outline"
      className={cn("gap-2", className)}
      onClick={onNewContext}
    >
      <PlusIcon className="h-4 w-4" />
      {label}
    </Button>
  );
}
