"use client"

import React, { useEffect, useMemo, useRef } from "react"
import { MeshGradient, LiquidMetal } from "@paper-design/shaders-react"

type Theme = "dark" | "light"

interface SquareOptions {
  size?: number
  rotation?: number
  color?: string
  borderColor?: string
  borderWidth?: number
  rotationOffset?: number
}

interface FigureOptions {
  squares?: Square[]
}

interface Animation {
  name: string
  duration: number
  elapsedTime: number
  finished: boolean
  update: (deltaTime: number, elapsedTime: number) => void
  onComplete?: () => void
}

class Figure {
  public squares: Square[]
  public offsetX: number
  public offsetY: number

  constructor(options: FigureOptions = {}) {
    this.squares = options.squares || []
    this.offsetX = 0
    this.offsetY = 0
  }

  public draw(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
    ctx.save()
    ctx.translate(canvasWidth / 2 + this.offsetX, canvasHeight / 2 + this.offsetY)
    this.squares.forEach((square: Square) => square.draw(ctx))
    ctx.restore()
  }
}

class Square {
  public size: number
  public rotation: number
  public color: string
  public borderColor: string
  public borderWidth: number
  public scale: number
  public rotationOffset: number
  public accumulatedRotation: number
  public isRotated: boolean
  public initialRotation: number
  public initialScale: number
  public motionBlur: number
  public originalBorderColor: string
  public originalColor: string

  constructor(options: SquareOptions = {}) {
    this.size = options.size || 100
    this.rotation = options.rotation || 0
    this.color = options.color || "rgba(0, 0, 0, 0)"
    this.borderColor = options.borderColor || "#000000"
    this.borderWidth = options.borderWidth || 4
    this.scale = 1
    this.rotationOffset = options.rotationOffset || 0
    this.accumulatedRotation = 0
    this.isRotated = false
    this.initialRotation = this.rotation
    this.initialScale = this.scale
    this.motionBlur = 0
    this.originalBorderColor = this.borderColor
    this.originalColor = this.color
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.rotate(((this.rotation + this.rotationOffset) * Math.PI) / 180)
    ctx.scale(this.scale, this.scale)

    if (this.motionBlur > 0) {
      const steps = 5
      const alpha = 0.3 / steps

      for (let i = 0; i < steps; i++) {
        ctx.save()
        ctx.rotate(((-this.motionBlur * 5 * i) * Math.PI) / 180)
        ctx.globalAlpha = alpha * (steps - i)

        ctx.fillStyle = this.color
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size)

        if (this.borderColor && this.borderWidth) {
          ctx.lineWidth = this.borderWidth
          ctx.strokeStyle = this.borderColor
          ctx.strokeRect(-this.size / 2, -this.size / 2, this.size, this.size)
        }

        ctx.restore()
      }
    } else {
      ctx.fillStyle = this.color
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size)

      if (this.borderColor && this.borderWidth) {
        ctx.lineWidth = this.borderWidth
        ctx.strokeStyle = this.borderColor
        ctx.strokeRect(-this.size / 2, -this.size / 2, this.size, this.size)
      }
    }

    ctx.restore()
  }
}

class OrbEngine {
  public figure: Figure
  public canvas: HTMLCanvasElement
  public ctx: CanvasRenderingContext2D
  public lastTime: number | null
  public squareAnimations: (Animation | null)[]
  public idleAnimations: Animation[]
  public animationQueues: Animation[][]
  public pendingAnimations: (() => void)[]
  private isLoading: boolean
  private isRandomAnimating: boolean
  private shaderMode: "none" | "figure"
  private getShaderCanvas?: () => HTMLCanvasElement | null
  private maskCanvas?: HTMLCanvasElement

  constructor(figure: Figure, canvasElement: HTMLCanvasElement) {
    this.figure = figure
    this.canvas = canvasElement
    const context = this.canvas.getContext("2d")
    if (!context) {
      throw new Error("CanvasRenderingContext2D not available")
    }
    this.ctx = context
    this.lastTime = null
    this.squareAnimations = this.figure.squares.map(() => null)
    this.idleAnimations = []
    this.animationQueues = this.figure.squares.map(() => [])
    this.pendingAnimations = []
    this.isLoading = false
    this.isRandomAnimating = false
    this.shaderMode = "none"

    this.animate = this.animate.bind(this)

    this.canvas.addEventListener("click", () => {
      if (!this.isAnimating()) {
        this.explode()
      } else {
        this.queueAnimation(() => this.explode())
      }
    })

    this.setupIdleAnimations()
    requestAnimationFrame(this.animate)
  }

  public setShader(getter: (() => HTMLCanvasElement | null) | undefined, mode: "none" | "figure"): void {
    this.getShaderCanvas = getter
    this.shaderMode = mode
  }

  public loading(shouldLoad: boolean = true): void {
    this.isLoading = shouldLoad
  }

  public setupIdleAnimations(): void {
    this.idleAnimations = this.figure.squares.map((square: Square, index: number) => {
      const idleAnimation: Animation = {
        name: "idle",
        duration: Infinity,
        elapsedTime: 0,
        finished: false,
        update: (_deltaTime: number, elapsedTime: number) => {
          const pulseAmplitude = 0.05 + index * 0.01
          const scaleSpeed = 0.001 + index * 0.0005
          const t = elapsedTime * scaleSpeed
          square.scale = square.initialScale + Math.sin(t) * pulseAmplitude
        },
      }
      return idleAnimation
    })
  }

  public reset(): void {
    this.isRandomAnimating = false
    const squaresToReset = this.figure.squares
      .map((square: Square, index: number) => (square.isRotated ? index : null))
      .filter((index: number | null) => index !== null)

    if ((squaresToReset as number[]).length > 0) {
      this.playRotationAnimation(squaresToReset as number[], 45, 1000)
    }

    this.figure.squares.forEach((_square: Square, index: number) => {
      this.squareAnimations[index] = this.squareAnimations[index] || null
      this.idleAnimations[index].elapsedTime = 0
      this.idleAnimations[index].finished = false
    })
  }

  public playRotationAnimation(squareIndices: number[], angle: number, duration: number): void {
    squareIndices.forEach((index: number) => {
      const square = this.figure.squares[index]
      const startRotation = square.rotation

      const animation: Animation = {
        name: "rotate",
        duration: duration || 1000,
        elapsedTime: 0,
        finished: false,
        update: (_deltaTime: number, elapsedTime: number) => {
          const progress = elapsedTime / animation.duration
          const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2

          if (angle === 360) {
            const velocity = Math.sin(progress * Math.PI)
            square.motionBlur = velocity * 0.3
          }

          const newRotation = startRotation + easedProgress * angle
          square.rotation = newRotation
        },
        onComplete: () => {
          square.rotation = startRotation + angle
          square.accumulatedRotation = (square.accumulatedRotation + angle) % 360
          if (angle === 45) {
            square.isRotated = !square.isRotated
          }
          square.motionBlur = 0

          if (this.animationQueues[index].length > 0) {
            this.squareAnimations[index] = this.animationQueues[index].shift()!
          } else {
            this.squareAnimations[index] = null
          }
        },
      }

      if (this.squareAnimations[index]) {
        this.animationQueues[index].push(animation)
      } else {
        this.squareAnimations[index] = animation
      }
    })
  }

  public playScaleAnimation(squareIndices: number[], scaleFactor: number, duration: number): void {
    squareIndices.forEach((index: number) => {
      const square = this.figure.squares[index]
      this.squareAnimations[index] = null

      const startScale = square.scale
      const targetScale = square.initialScale * scaleFactor

      const animation: Animation = {
        name: "scale",
        duration: duration || 1000,
        elapsedTime: 0,
        finished: false,
        update: (_deltaTime: number, elapsedTime: number) => {
          const progress = elapsedTime / animation.duration
          const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
          if (progress < 0.5) {
            const scale = startScale + easedProgress * (targetScale - startScale)
            square.scale = scale
          } else {
            const scale = targetScale - (easedProgress - 0.5) * 2 * (targetScale - startScale)
            square.scale = scale
          }
        },
        onComplete: () => {
          square.scale = square.initialScale
          this.squareAnimations[index] = null

          if (this.animationQueues[index].length > 0) {
            const nextAnimation = this.animationQueues[index].shift()!
            this.squareAnimations[index] = nextAnimation
          }
        },
      }

      if (this.squareAnimations[index]) {
        this.animationQueues[index].push(animation)
      } else {
        this.squareAnimations[index] = animation
      }
    })
  }

  public playScaleAnimationWithDelay(squareIndex: number, scaleFactor: number, duration: number, delay: number): void {
    const square = this.figure.squares[squareIndex]
    const startScale = square.scale
    const targetScale = square.initialScale * scaleFactor

    const animation: Animation = {
      name: "scale",
      duration: duration,
      elapsedTime: -delay,
      finished: false,
      update: (_deltaTime: number, elapsedTime: number) => {
        if (elapsedTime < 0) {
          return
        }

        const progress = elapsedTime / animation.duration

        if (progress < 0.5) {
          const upProgress = progress * 2
          const easeUp = 1 - Math.cos((upProgress * Math.PI) / 2)
          square.scale = startScale + easeUp * (targetScale - startScale)
        } else {
          const downProgress = (progress - 0.5) * 2
          const easeDown = Math.cos((downProgress * Math.PI) / 2)
          square.scale = square.initialScale + easeDown * (targetScale - square.initialScale)
        }
      },
      onComplete: () => {
        square.scale = square.initialScale

        if (this.animationQueues[squareIndex].length > 0) {
          this.squareAnimations[squareIndex] = this.animationQueues[squareIndex].shift()!
        } else {
          this.squareAnimations[squareIndex] = null
        }
      },
    }

    if (this.squareAnimations[squareIndex]) {
      this.animationQueues[squareIndex].push(animation)
    } else {
      this.squareAnimations[squareIndex] = animation
    }
  }

  public animate(timestamp: number): void {
    if (!this.lastTime) {
      this.lastTime = timestamp
    }
    const deltaTime = timestamp - this.lastTime
    this.lastTime = timestamp

    this.update(deltaTime)
    this.draw()

    requestAnimationFrame(this.animate)
  }

  public update(deltaTime: number): void {
    let allAnimationsFinished = true

    this.squareAnimations.forEach((animation: Animation | null, index: number) => {
      if (animation && !animation.finished) {
        allAnimationsFinished = false
        animation.elapsedTime += deltaTime

        if (animation.elapsedTime >= animation.duration) {
          animation.update(deltaTime, animation.duration)
          if (animation.onComplete) {
            animation.onComplete()
          }
          animation.finished = true

          if (this.animationQueues[index].length > 0) {
            this.squareAnimations[index] = this.animationQueues[index].shift()!
            allAnimationsFinished = false
          }
        } else {
          animation.update(deltaTime, animation.elapsedTime)
        }
      }
    })

    if (allAnimationsFinished && this.pendingAnimations && this.pendingAnimations.length > 0) {
      const nextAnimation = this.pendingAnimations.shift()
      if (nextAnimation) {
        nextAnimation()
      }
    }

    if (allAnimationsFinished) {
      this.idleAnimations.forEach((idleAnimation: Animation) => {
        if (idleAnimation && !idleAnimation.finished) {
          idleAnimation.elapsedTime += deltaTime
          idleAnimation.update(deltaTime, idleAnimation.elapsedTime)
        }
      })
    }
  }

  public draw(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (this.shaderMode === "figure") {
      const shaderCanvas = this.getShaderCanvas ? this.getShaderCanvas() : null
      if (shaderCanvas && shaderCanvas.width > 0 && shaderCanvas.height > 0) {
        this.drawShaderMaskedToOrb(shaderCanvas)
        return
      }
    }
    this.ctx.save()
    this.figure.draw(this.ctx, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  private drawShaderMaskedToOrb(shaderCanvas: HTMLCanvasElement): void {
    const ctx = this.ctx

    // 0) Preparar canvas de máscara (union de las superficies del orbe)
    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement("canvas")
    }
    const m = this.maskCanvas
    if (m.width !== this.canvas.width || m.height !== this.canvas.height) {
      m.width = this.canvas.width
      m.height = this.canvas.height
    }
    const mctx = m.getContext("2d")!
    mctx.clearRect(0, 0, m.width, m.height)
    mctx.save()
    mctx.translate(this.canvas.width / 2 + this.figure.offsetX, this.canvas.height / 2 + this.figure.offsetY)
    mctx.fillStyle = "#fff"

    const drawRingTo = (c: CanvasRenderingContext2D, size: number, borderWidth: number, rotationDeg: number, scale: number) => {
      // strokeRect en el render original centra el trazo sobre el borde del rectángulo de tamaño `size`.
      // Por lo tanto, el contorno visible final extiende +borderWidth/2 hacia afuera y -borderWidth/2 hacia adentro.
      // Para que la máscara coincida exactamente, usamos outer = size + borderWidth y inner = size - borderWidth.
      const outer = size + borderWidth
      const inner = Math.max(0, size - borderWidth)
      c.save()
      c.rotate((rotationDeg * Math.PI) / 180)
      c.scale(scale, scale)
      c.beginPath()
      c.rect(-outer / 2, -outer / 2, outer, outer)
      c.rect(-inner / 2, -inner / 2, inner, inner)
      c.fill("evenodd")
      c.restore()
    }

    const outer = this.figure.squares[0]
    const middle = this.figure.squares[1]
    const center = this.figure.squares[this.figure.squares.length - 1]
    if (outer && outer.borderWidth > 0) {
      drawRingTo(mctx, outer.size, outer.borderWidth, outer.rotation + outer.rotationOffset, outer.scale)
    }
    if (middle && middle.borderWidth > 0) {
      drawRingTo(mctx, middle.size, middle.borderWidth, middle.rotation + middle.rotationOffset, middle.scale)
    }
    if (center) {
      mctx.save()
      mctx.rotate(((center.rotation + center.rotationOffset) * Math.PI) / 180)
      mctx.scale(center.scale, center.scale)
      // Centro en el original es fill + stroke. Para coincidir el contorno total, expandimos por +borderWidth/2 en cada lado.
      const centerOuter = center.size + (center.borderWidth || 0)
      mctx.fillRect(-centerOuter / 2, -centerOuter / 2, centerOuter, centerOuter)
      mctx.restore()
    }
    mctx.restore()

    // 1) Pintar shader en destino
    ctx.save()
    ctx.drawImage(shaderCanvas, 0, 0, this.canvas.width, this.canvas.height)
    // 2) Aplicar máscara en una sola operación (union)
    ctx.globalCompositeOperation = "destination-in"
    ctx.drawImage(m, 0, 0)
    ctx.restore()
    ctx.globalCompositeOperation = "source-over"
  }

  public rotate45(): void {
    const squareIndices = [0, 1, 2]
    this.playRotationAnimation(squareIndices, 45, 1000)
  }

  public rotate45Center(): void {
    this.playRotationAnimation([2], 45, 1000)
  }

  public rotate45External(withChilds: boolean = false): void {
    if (withChilds) {
      this.playRotationAnimation([0, 1, 2], 45, 1000)
    } else {
      this.playRotationAnimation([0], 45, 1000)
    }
  }

  public rotate45Middle(withChilds: boolean = false): void {
    if (withChilds) {
      this.playRotationAnimation([1, 2], 45, 1000)
    } else {
      this.playRotationAnimation([1], 45, 1000)
    }
  }

  public explode(onComplete?: () => void): void {
    const animations = [
      { index: 0, scale: 1.2, duration: 1200, delay: 0 },
      { index: 1, scale: 1.3, duration: 900, delay: 100 },
      { index: 2, scale: 1.5, duration: 600, delay: 200 },
    ]

    animations.forEach(({ index, scale, duration, delay }) => {
      if (index === animations.length - 1 && onComplete) {
        const originalAnimation = this.squareAnimations[index]
        if (originalAnimation && "onComplete" in originalAnimation) {
          const originalOnComplete = originalAnimation.onComplete
          originalAnimation.onComplete = () => {
            if (originalOnComplete) {
              originalOnComplete()
            }
            onComplete()
          }
        }
      }
      this.playScaleAnimationWithDelay(index, scale, duration, delay)
    })
  }

  public spin(): void {
    this.playRotationAnimation([0], 180, 2000)
    this.playRotationAnimation([1], 360, 2000)
    this.playRotationAnimation([2], 720, 2000)
  }

  public isAnimatingSquare(squareIndex: number): boolean {
    const hasActive = this.squareAnimations[squareIndex] !== null
    const hasQueue = this.animationQueues[squareIndex].length > 0
    return hasActive || hasQueue
  }

  public queueAnimation(animationCallback: () => void): void {
    this.pendingAnimations = this.pendingAnimations || []
    this.pendingAnimations.push(animationCallback)
  }

  public isAnimating(): boolean {
    return this.figure.squares.some((_, index) => this.isAnimatingSquare(index))
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) {
      return null
    }
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
  }

  public alert(fromColor: string, toColor?: string, initialDuration?: number, repetitions?: number): void {
    const targetColor = toColor || fromColor
    const baseDuration = initialDuration || 2000
    const loops = repetitions === undefined ? 1 : repetitions

    ;[0, 1, 2].forEach((index) => {
      const square = this.figure.squares[index]
      const startScale = square.scale
      const maxScale = square.initialScale * (1.1 + index * 0.05)

      const fromRGB = this.hexToRgb(fromColor)
      const toRGB = this.hexToRgb(targetColor)
      if (!fromRGB || !toRGB) {
        return
      }

      const progressBase = index / 2
      const targetRGB = {
        r: Math.round(fromRGB.r + (toRGB.r - fromRGB.r) * progressBase),
        g: Math.round(fromRGB.g + (toRGB.g - fromRGB.g) * progressBase),
        b: Math.round(fromRGB.b + (toRGB.b - fromRGB.b) * progressBase),
      }

      const totalDuration = Array.from({ length: loops }, (_: unknown, i: number) => Math.max(500, baseDuration - i * 300)).reduce((a: number, b: number) => a + b, 0)

      const animation: Animation = {
        name: "alert",
        duration: totalDuration,
        elapsedTime: -index * (baseDuration * 0.1),
        finished: false,
        update: (_deltaTime: number, elapsedTime: number) => {
          if (elapsedTime < 0) {
            return
          }

          let currentRepetition = 0
          let timeInCurrentRepetition = elapsedTime

          for (let i = 0; i < loops; i++) {
            const currentDuration = Math.max(500, baseDuration - i * 300)
            if (timeInCurrentRepetition < currentDuration) {
              currentRepetition = i
              break
            }
            timeInCurrentRepetition -= currentDuration
          }

          if (currentRepetition >= loops) {
            animation.finished = true
            return
          }

          const currentDuration = Math.max(500, baseDuration - currentRepetition * 300)
          const progress = timeInCurrentRepetition / currentDuration

          if (progress <= 0.5) {
            const upProgress = progress * 2
            const easeUp = 1 - Math.cos((upProgress * Math.PI) / 2)

            square.scale = startScale + (maxScale - startScale) * easeUp

            const colorThreshold = 0.3
            const shouldColor = upProgress >= index * colorThreshold

            if (shouldColor) {
              const individualProgress = Math.min(1, (upProgress - index * colorThreshold) / colorThreshold)
              const easeColor = 1 - Math.cos((individualProgress * Math.PI) / 2)

              const r = Math.round(255 + (targetRGB.r - 255) * easeColor)
              const g = Math.round(255 + (targetRGB.g - 255) * easeColor)
              const b = Math.round(255 + (targetRGB.b - 255) * easeColor)

              square.borderColor = `rgb(${r}, ${g}, ${b})`
              if (square.originalColor !== "rgba(0, 0, 0, 0)") {
                square.color = `rgb(${r}, ${g}, ${b})`
              }
            }
          } else {
            const fadeProgress = (progress - 0.5) * 2
            const fadeThreshold = 0.3
            const shouldFade = fadeProgress >= index * fadeThreshold

            if (shouldFade) {
              const individualFadeProgress = Math.min(1, (fadeProgress - index * fadeThreshold) / fadeThreshold)
              const easeFade = Math.cos((individualFadeProgress * Math.PI) / 2)

              const r = Math.round(255 + (targetRGB.r - 255) * easeFade)
              const g = Math.round(255 + (targetRGB.g - 255) * easeFade)
              const b = Math.round(255 + (targetRGB.b - 255) * easeFade)

              square.borderColor = `rgb(${r}, ${g}, ${b})`
              if (square.originalColor !== "rgba(0, 0, 0, 0)") {
                square.color = `rgb(${r}, ${g}, ${b})`
              }

              square.scale = square.initialScale + (maxScale - square.initialScale) * easeFade
            }
          }
        },
        onComplete: () => {
          square.scale = square.initialScale
          square.borderColor = square.originalBorderColor
          square.color = square.originalColor

          if (this.animationQueues[index].length > 0) {
            this.squareAnimations[index] = this.animationQueues[index].shift()!
          } else {
            this.squareAnimations[index] = null
          }
        },
      }

      if (this.squareAnimations[index]) {
        this.animationQueues[index].push(animation)
      } else {
        this.squareAnimations[index] = animation
      }
    })
  }
}

export interface OrbProps {
  width?: number
  height?: number
  initialAnimation?: string
  theme?: Theme
  className?: string
  ariaHidden?: boolean
  shader?: {
    type: "mesh-gradient" | "liquid-metal"
    colors?: string[]
    distortion?: number
    swirl?: number
    speed?: number
    position?: "figure" // only figure is supported; background/foreground are ignored
    // LiquidMetal specific (optional)
    colorBack?: string
    colorTint?: string
    repetition?: number
    softness?: number
    shiftRed?: number
    shiftBlue?: number
    contour?: number
    shape?: string
    offsetX?: number
    offsetY?: number
    scale?: number
    rotation?: number
  }
}

export function Orb(props: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const orbRef = useRef<OrbEngine | null>(null)
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const shaderHostRef = useRef<HTMLDivElement | null>(null)

  const width = props.width || 360
  const height = props.height || 360
  const theme: Theme = props.theme || "dark"
  const initialAnimation = props.initialAnimation

  const baseColor = useMemo(() => {
    if (theme === "dark") {
      return "rgba(255, 255, 255, 0.9)"
    }
    return "rgba(0, 0, 0, 0.9)"
  }, [theme])

  useEffect(() => {
    if (!canvasRef.current) {
      return
    }

    const canvas = canvasRef.current
    canvas.width = width
    canvas.height = height

    const canvasSize = Math.min(canvas.width, canvas.height)
    const outerSquareSize = canvasSize * 0.5
    const middleSquareSize = outerSquareSize * 0.45
    const centerSquareSize = middleSquareSize * 0.16
    const borderWidth = outerSquareSize * 0.15

    const figure = new Figure({
      squares: [
        new Square({
          size: outerSquareSize,
          rotationOffset: 0,
          rotation: 45,
          color: "rgba(0, 0, 0, 0)",
          borderColor: baseColor,
          borderWidth: borderWidth,
        }),
        new Square({
          size: middleSquareSize,
          rotationOffset: 0,
          rotation: 45,
          color: "rgba(0, 0, 0, 0)",
          borderColor: baseColor,
          borderWidth: borderWidth,
        }),
        new Square({
          size: centerSquareSize,
          rotationOffset: 0,
          rotation: 45,
          color: baseColor,
          borderColor: baseColor,
          borderWidth: centerSquareSize * 0.2,
        }),
      ],
    })

    const orb = new OrbEngine(figure, canvas)
    orbRef.current = orb

    if (initialAnimation) {
      if (initialAnimation === "stopLoading") {
        orb.loading(false)
      } else if (initialAnimation === "idle") {
        orb.loading(false)
        orb.reset()
      } else {
        const anyOrb = orb as unknown as Record<string, unknown>
        const fn = anyOrb[initialAnimation] as unknown
        if (typeof fn === "function") {
          ;(fn as Function).call(orb)
        }
      }
    }

    return () => {
      orbRef.current = null
    }
  }, [width, height, baseColor, initialAnimation])

  useEffect(() => {
    if (!orbRef.current) {
      return
    }
    const orb = orbRef.current
    const squares = orb.figure.squares
    squares.forEach((square) => {
      square.originalBorderColor = baseColor
      square.borderColor = baseColor
      if (square.originalColor !== "rgba(0, 0, 0, 0)") {
        square.originalColor = baseColor
        square.color = baseColor
      }
    })
  }, [baseColor])

  const renderShader = () => {
    if (!props.shader) {
      return null
    }
    if (props.shader.type === "mesh-gradient") {
      const colors = Array.isArray(props.shader.colors) && props.shader.colors.length > 0 ? props.shader.colors : ["#ffffff", "#a3a3a3", "#e5e5e5"]
      const distortion = typeof props.shader.distortion === "number" ? props.shader.distortion : 0.9
      const swirl = typeof props.shader.swirl === "number" ? props.shader.swirl : 0.6
      const speed = typeof props.shader.speed === "number" ? props.shader.speed : 0.2
      return (
        <div ref={shaderHostRef} className="w-full h-full">
          <MeshGradient
            colors={colors as any}
            distortion={distortion as any}
            swirl={swirl as any}
            speed={speed as any}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      )
    }
    if (props.shader.type === "liquid-metal") {
      const colorTint = props.shader.colorTint || "hsl(0, 0%, 100%)"
      const colorBack = props.shader.colorBack || colorTint
      const repetition = typeof props.shader.repetition === "number" ? props.shader.repetition : 4
      const softness = typeof props.shader.softness === "number" ? props.shader.softness : 0.3
      const shiftRed = typeof props.shader.shiftRed === "number" ? props.shader.shiftRed : 0.3
      const shiftBlue = typeof props.shader.shiftBlue === "number" ? props.shader.shiftBlue : 0.3
      const distortion = typeof props.shader.distortion === "number" ? props.shader.distortion : 0.1
      const contour = typeof props.shader.contour === "number" ? props.shader.contour : 1
      const shape = props.shader.shape || "none"
      const offsetX = typeof props.shader.offsetX === "number" ? props.shader.offsetX : 0
      const offsetY = typeof props.shader.offsetY === "number" ? props.shader.offsetY : 0
      const scale = typeof props.shader.scale === "number" ? props.shader.scale : 1
      const rotation = typeof props.shader.rotation === "number" ? props.shader.rotation : 0
      const speed = typeof props.shader.speed === "number" ? props.shader.speed : 1
      return (
        <div ref={shaderHostRef} className="w-full h-full">
          <LiquidMetal
            style={{ width: "100%", height: "100%" }}
            colorBack={colorBack as any}
            colorTint={colorTint as any}
            repetition={repetition as any}
            softness={softness as any}
            shiftRed={shiftRed as any}
            shiftBlue={shiftBlue as any}
            distortion={distortion as any}
            contour={contour as any}
            shape={shape as any}
            offsetX={offsetX as any}
            offsetY={offsetY as any}
            scale={scale as any}
            rotation={rotation as any}
            speed={speed as any}
          />
        </div>
      )
    }
    return null
  }

  useEffect(() => {
    const link = () => {
      const canvas = shaderHostRef.current ? (shaderHostRef.current.querySelector("canvas") as HTMLCanvasElement | null) : null
      if (!canvas) {
        return false
      }
      shaderCanvasRef.current = canvas
      if (orbRef.current) {
        const mode = props.shader ? "figure" : "none"
        orbRef.current.setShader(() => shaderCanvasRef.current, mode)
      }
      return true
    }
    if (props.shader) {
      const ok = link()
      if (!ok) {
        const id = setTimeout(() => { link() }, 50)
        return () => clearTimeout(id)
      }
    } else if (orbRef.current) {
      orbRef.current.setShader(undefined, "none")
    }
  }, [props.shader?.type, props.shader?.colors, props.shader?.distortion, props.shader?.swirl, props.shader?.speed, props.shader?.colorBack, props.shader?.colorTint, props.shader?.repetition, props.shader?.softness, props.shader?.shiftRed, props.shader?.shiftBlue, props.shader?.contour, props.shader?.shape, props.shader?.offsetX, props.shader?.offsetY, props.shader?.scale, props.shader?.rotation])

  return (
    <div className={["relative", props.className || ""].join(" ")} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-hidden={props.ariaHidden === true}
        className="relative block"
      />
      {props.shader && (
        <div className="absolute inset-0 opacity-0 pointer-events-none" aria-hidden>
          {renderShader()}
        </div>
      )}
    </div>
  )
}



