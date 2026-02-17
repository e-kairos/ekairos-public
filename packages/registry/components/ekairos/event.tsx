import React from "react"
import { Message as AIMessage, MessageContent as AIMessageContent, MessageResponse } from "@/components/ai-elements/message"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning"
import { Sources, SourcesContent, SourcesTrigger, Source } from "@/components/ai-elements/sources"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { Image as AIImage } from "@/components/ai-elements/image"
import { InlineCitation } from "@/components/ai-elements/inline-citation"
import { Loader } from "@/components/ai-elements/loader"
import { Suggestion } from "@/components/ai-elements/suggestion"
import { Task } from "@/components/ai-elements/task"
import { Tool } from "@/components/ai-elements/tool"
import { WebPreview } from "@/components/ai-elements/web-preview"

export function Event({ role, parts, isStreaming }: { role: string; parts?: Array<any>; isStreaming?: boolean }) {
  return (
    <AIMessage from={role as any}>
      <AIMessageContent>
        {parts?.map((part: any, i: number) => {
          try {
            switch (part?.type) {
              case 'text':
                return <MessageResponse key={i}>{String(part.text ?? '')}</MessageResponse>
              case 'reasoning':
                return (
                  <Reasoning key={i} className="w-full" isStreaming={!!isStreaming}>
                    <ReasoningTrigger />
                    <ReasoningContent>{String(part.text ?? '')}</ReasoningContent>
                  </Reasoning>
                )
              case 'source-url':
                return (
                  <Sources key={i}>
                    <SourcesTrigger count={1} />
                    <SourcesContent>
                      <Source href={String(part.url || '#')} title={String(part.url || '')} />
                    </SourcesContent>
                  </Sources>
                )
              case 'code':
                return <CodeBlock key={i} language={String(part.language || 'tsx')} code={String(part.code || part.text || '')} />
              case 'image':
                return (
                  <AIImage
                    key={i}
                    alt={String(part.alt || 'image')}
                    base64={String(part.base64 || '')}
                    mediaType={String(part.mediaType || 'image/png')}
                    uint8Array={new Uint8Array()}
                  />
                )
              case 'inline-citation':
                return <InlineCitation key={i} />
              case 'loader':
                return <Loader key={i} />
              case 'suggestion':
                return <Suggestion key={i} suggestion={String(part.text || '')} />
              case 'task':
                return <Task key={i} />
              case 'tool':
                return <Tool key={i} />
              case 'web-preview':
                return <WebPreview key={i} defaultUrl={String(part.url || '')} />
              default:
                return null
            }
          } catch (_) {
            return <MessageResponse key={i}>{JSON.stringify(part)}</MessageResponse>
          }
        })}
      </AIMessageContent>
    </AIMessage>
  )
}



