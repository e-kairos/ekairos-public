"use client"

import React, { useState } from "react"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep
} from "@/components/ai-elements/chain-of-thought"
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
        <ChainOfThought defaultOpen={isOpen}>
          <ChainOfThoughtHeader 
            status={step < 3 ? "thinking" : "complete"} 
            seconds={step === 3 ? 5 : undefined} 
          />
          <ChainOfThoughtContent>
            <ChainOfThoughtStep>
              **Retrieving Fibonacci sequence**

              The user asked for the Fibonacci sequence in Spanish. I need to call a function first, likely the createMessage tool since I'm answering the user. Even though it's a generic math question, I still have to use a tool. 
              
              I'll prepare to send a message with a brief explanation, even though the tool call won't be visible to the user. I should respond in Spanish and provide the first few terms of the sequence along with the formula.
            </ChainOfThoughtStep>

            <ChainOfThoughtStep>
              **Planning Fibonacci response**

              I should ask the user how many terms they want, but since the prompt is straightforward, I could simply provide the first 15 or 20 terms along with a definition. 
              
              I don't want to make it too verbose, so brevity is key. First, I'll call functions.createMessage to send a markdown message that summarizes the definition of the Fibonacci sequence.
            </ChainOfThoughtStep>
          </ChainOfThoughtContent>
        </ChainOfThought>

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
  <ChainOfThoughtHeader status="thinking" />
  <ChainOfThoughtContent>
    <ChainOfThoughtStep>
      Retrieving Fibonacci sequence...

      The user asked for the Fibonacci sequence in Spanish...
    </ChainOfThoughtStep>
    <ChainOfThoughtStep>
      **Planning Fibonacci response**

      I should ask the user how many terms they want...
    </ChainOfThoughtStep>
  </ChainOfThoughtContent>
</ChainOfThought>`,
  render: () => <InteractiveChainOfThoughtDemo />
}

