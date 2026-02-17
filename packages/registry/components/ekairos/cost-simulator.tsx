"use client"

import React, { useMemo, useState } from "react"

type Inputs = {
  basePrice: number
  b1: number
  b2: number
  b3: number
  tariffs: number
  freight: number
  insurance: number
  recoverableTaxes: number
  nonRecoverableTaxes: number
  fx: number
}

export default function CostSimulator({ initial }: { initial?: Partial<Inputs> }) {
  const [inp, setInp] = useState<Inputs>({
    basePrice: initial?.basePrice ?? 0,
    b1: initial?.b1 ?? 0,
    b2: initial?.b2 ?? 0,
    b3: initial?.b3 ?? 0,
    tariffs: initial?.tariffs ?? 0,
    freight: initial?.freight ?? 0,
    insurance: initial?.insurance ?? 0,
    recoverableTaxes: initial?.recoverableTaxes ?? 0,
    nonRecoverableTaxes: initial?.nonRecoverableTaxes ?? 0,
    fx: initial?.fx ?? 1,
  })

  const result = useMemo(() => {
    const discounts = (1 - (inp.b1 || 0) / 100) * (1 - (inp.b2 || 0) / 100) * (1 - (inp.b3 || 0) / 100)
    const netBase = inp.basePrice * discounts
    const additions = (inp.tariffs || 0) + (inp.freight || 0) + (inp.insurance || 0) + (inp.nonRecoverableTaxes || 0)
    const recoverables = (inp.recoverableTaxes || 0)
    const unitCost = (netBase + additions - recoverables) * (inp.fx || 1)
    const total = unitCost // por unidad; para total se multiplicaría por cantidad
    const suggestedMargin = 0.3
    const suggestedPrice = unitCost * (1 + suggestedMargin)
    return { unitCost, total, suggestedPrice }
  }, [inp])

  function onChange(key: keyof Inputs) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value)
      setInp((s) => ({ ...s, [key]: value }))
    }
  }

  return (
    <div className="rounded-sm border p-3 space-y-3" style={{ borderColor: 'var(--border-weak)' }}>
      <div className="text-sm font-medium">Simulador de costo “puesto”</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="Precio base"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.basePrice} onChange={onChange('basePrice')} /></Field>
        <Field label="B1 %"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.b1} onChange={onChange('b1')} /></Field>
        <Field label="B2 %"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.b2} onChange={onChange('b2')} /></Field>
        <Field label="B3 %"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.b3} onChange={onChange('b3')} /></Field>
        <Field label="Aranceles"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.tariffs} onChange={onChange('tariffs')} /></Field>
        <Field label="Flete"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.freight} onChange={onChange('freight')} /></Field>
        <Field label="Seguro"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.insurance} onChange={onChange('insurance')} /></Field>
        <Field label="Imp. recuperables"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.recoverableTaxes} onChange={onChange('recoverableTaxes')} /></Field>
        <Field label="Imp. no recuperables"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.nonRecoverableTaxes} onChange={onChange('nonRecoverableTaxes')} /></Field>
        <Field label="Tipo de cambio"><input type="number" className="w-full px-2 py-1 bg-transparent border border-white/20" value={inp.fx} onChange={onChange('fx')} /></Field>
      </div>
      <div className="rounded-sm border p-2 text-sm space-y-1" style={{ borderColor: 'var(--border-weak)' }}>
        <div>• Costo unitario neto: <strong>${result.unitCost.toFixed(2)}</strong></div>
        <div>• Costo total: <strong>${result.total.toFixed(2)}</strong></div>
        <div>• Precio sugerido: <strong>${result.suggestedPrice.toFixed(2)}</strong></div>
      </div>
      <div className="flex items-center justify-end">
        <button type="button" className="px-3 py-2 border border-white/40 text-xs">Usar como costo de referencia</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="opacity-60 mb-1">{label}</div>
      {children}
    </div>
  )
}



