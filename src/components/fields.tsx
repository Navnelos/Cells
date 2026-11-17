import { useEffect, useId, useState, type ReactNode } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-4 border-b px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  hint,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  const shown = format ? format(value) : step >= 1 ? String(Math.round(value)) : value.toFixed(step >= 0.1 ? 1 : 2)
  return (
    <div className={cn("space-y-2", disabled && "opacity-50")} title={hint}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-[13px] font-normal">{label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{shown}</span>
      </div>
      <Slider id={id} min={min} max={max} step={step} value={[value]} disabled={disabled} onValueChange={(v) => onChange(v[0])} />
    </div>
  )
}

export function SwitchField({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: string
}) {
  const id = useId()
  return (
    <div className={cn("flex items-center justify-between gap-3", disabled && "opacity-50")} title={hint}>
      <Label htmlFor={id} className="text-[13px] font-normal">{label}</Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-[13px] font-normal">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function SegmentField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="space-y-2">
      {label && <Label className="text-[13px] font-normal">{label}</Label>}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        className="w-full"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} title={o.title} aria-label={o.title ?? String(o.value)} className="text-xs">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

const HEX = /^#?[0-9a-f]{6}$/i

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    if (HEX.test(text)) onChange(text.startsWith("#") ? text.toLowerCase() : `#${text.toLowerCase()}`)
    else setText(value)
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-[13px] font-normal">{label}</Label>
      <div className="flex items-center gap-2">
        <label
          className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-xs"
          style={{ background: value }}
          title="Pick colour"
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="h-8 w-24 font-mono text-xs"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
