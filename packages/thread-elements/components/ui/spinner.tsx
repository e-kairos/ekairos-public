import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

export type SpinnerProps = SVGProps<SVGSVGElement>

export function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <svg
      aria-label="Loading"
      className={cn("size-4 animate-spin text-current", className)}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
      />
    </svg>
  )
}
