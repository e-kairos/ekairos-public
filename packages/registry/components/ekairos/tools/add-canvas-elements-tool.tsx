"use client"

import { ToolComponentType } from "./types"
import { Button } from "@/components/ui/button"
import { useCanvas } from "@/app/components/canvas-provider"
import dynamic from "next/dynamic"
import { useCallback, useMemo, useState } from "react"
import { useTheme } from "@/app/components/theme-provider"

type AddCanvasElementsInput = {
  elements: unknown[]
}

type AddCanvasElementsOutput = {
  ok: boolean
  elements: unknown[]
}

export const AddCanvasElementsTool: ToolComponentType<AddCanvasElementsInput, AddCanvasElementsOutput> = ({ input, output, state }) => {
  const { bridge } = useCanvas()
  const { theme } = useTheme()
  const [isApplying, setIsApplying] = useState(false)

  const ExcalidrawPreview = useMemo(() => dynamic(async () => {
    const module = (await import("@excalidraw/excalidraw")) as any

    return function ExcalidrawPreviewImpl(props: { elements: unknown[]; theme: "light" | "dark" })
    {
      const handleReady = useCallback(async (api: any): Promise<void> =>
      {
        try
        {
          const excalidraw = (await import("@excalidraw/excalidraw")) as any
          const elementsForRestore: any = props.elements
          const restored = excalidraw.restoreElements(elementsForRestore, null)

          api.updateScene({
            elements: Array.isArray(restored) ? restored : [],
          })
        }
        catch (error)
        {
          console.error("preview:restore:error", error)
        }
      }, [props.elements])

      return (
        <module.Excalidraw
          excalidrawAPI={handleReady}
          onChange={() => {}}
          theme={props.theme}
          viewModeEnabled={true}
          zenModeEnabled={true}
          gridModeEnabled={false}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: false,
              saveAsImage: false,
            }
          }}
        >
          <module.Sidebar name="custom">{null}</module.Sidebar>
          <module.Footer>{null}</module.Footer>
          <module.MainMenu>{null}</module.MainMenu>
          <module.WelcomeScreen>{null}</module.WelcomeScreen>
        </module.Excalidraw>
      )
    }
  }, { ssr: false }), [])

  const handleAddElements = async () => {
    if (!output || !output.elements)
    {
      console.error("No elements to add")
      return
    }

    try
    {
      setIsApplying(true)
      console.log("Adding elements to canvas", output.elements)
      await bridge.addElements(output.elements)
    }
    finally
    {
      setIsApplying(false)
    }
  }

  if (state === "output-available" && output)
  {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border overflow-hidden" style={{ height: 240 }}>
          <ExcalidrawPreview elements={output.elements || []} theme={theme} />
        </div>
        <div className="text-sm">
          <p>Ready to add {output.elements?.length || 0} element(s) to canvas</p>
        </div>
        <Button onClick={handleAddElements} className="w-full" disabled={isApplying}>
          {isApplying ? "Adding..." : "Add to Canvas"}
        </Button>
      </div>
    )
  }

  if (state === "input-available" || state === "input-streaming")
  {
    return (
      <div className="text-sm text-muted-foreground">
        Preparing elements...
      </div>
    )
  }

  return null
}

AddCanvasElementsTool.meta = {
  title: "Add Canvas Elements"
}

