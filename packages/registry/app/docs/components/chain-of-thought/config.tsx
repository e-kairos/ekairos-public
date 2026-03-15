"use client"

import React, { useState } from "react"
import type { RegistryItem } from "@/lib/registry-types"

const InteractiveChainOfThoughtDemo = () => {
  const [step, setStep] = useState(0)
  const [isOpen, setIsOpen] = useState(true)

  const runSimulation = () => {
    setStep(0)
    setIsOpen(true)

    const interval = setInterval(() => {
      setStep(prev => {
        if (prev >= 3) {
          clearInterval(interval)
          return 3
        }
        return prev + 1
      })
    }, 1500)
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="border p-4 rounded-lg bg-background shadow-sm">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Chain of thought</span>
            <span>{isOpen ? "open" : "closed"}</span>
          </div>
          {[
            {
              label: "Retrieving Fibonacci sequence",
              text: "The user asked for the Fibonacci sequence in Spanish. I should answer concisely and keep the response practical.",
            },
            {
              label: "Planning Fibonacci response",
              text: "I can provide a short explanation, the first terms, and ask if the user wants more items or the recurrence formula.",
            },
          ].map((item, index) => (
            <div
              key={item.label}
              className={`rounded-md border p-3 transition-opacity ${step >= index + 1 ? "opacity-100" : "opacity-40"}`}
            >
              <p className="font-medium text-sm">{item.label}</p>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </div>
          ))}
        </div>

        {step === 3 && (
          <div className="mt-4 p-3 bg-muted/20 rounded text-sm animate-in fade-in slide-in-from-top-2">
            Analysis complete. Here is the result based on the reasoning steps above.
          </div>
        )}
      </div>

      <button
        onClick={runSimulation}
        disabled={step > 0 && step < 3}
        className="w-full py-2 px-4 bg-primary/10 text-primary hover:bg-primary/20 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
      >
        {step > 0 && step < 3 ? "Reasoning..." : "Replay Simulation"}
      </button>
    </div>
  )
}

export const chainOfThoughtRegistryItem: RegistryItem = {
  id: "chain-of-thought",
  registryName: "chain-of-thought",
  title: "Chain of Thought",
  subtitle: "Collapsible component to visualize AI reasoning steps.",
  category: "compound",
  props: [
    { name: "defaultOpen", type: "boolean", default: "false", description: "Whether the thought process is visible initially." },
    { name: "status", type: "'pending' | 'active' | 'complete'", default: "complete", description: "State of the specific reasoning step." }
  ],
  code: `<ChainOfThought defaultOpen={true}>
  <ChainOfThoughtHeader />
  <ChainOfThoughtContent>
    <ChainOfThoughtStep label="Retrieving Fibonacci sequence">
      Retrieving Fibonacci sequence...

      The user asked for the Fibonacci sequence in Spanish...
    </ChainOfThoughtStep>
    <ChainOfThoughtStep label="Planning Fibonacci response">
      **Planning Fibonacci response**

      I should ask the user how many terms they want...
    </ChainOfThoughtStep>
  </ChainOfThoughtContent>
</ChainOfThought>`,
  render: () => <InteractiveChainOfThoughtDemo />
}

