import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import type { SelectOption } from '../types'

interface SelectFieldProps {
  label: string
  description?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
}

interface TextFieldProps {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'url'
}

interface TextareaFieldProps {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

interface ToggleSwitchProps {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function SelectField({ label, description, value, options, onChange, placeholder }: SelectFieldProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const selectedOption = options.find((option) => option.value === value)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  return (
    <div ref={containerRef} className={`form-field${open ? ' form-field--open' : ''}`}>
      <div className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <p className="form-field__description">{description}</p> : null}
      </div>

      <button
        type="button"
        className={`select-trigger${open ? ' select-trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="select-trigger__copy">
          <span className="select-trigger__value">{selectedOption?.label ?? placeholder ?? '请选择'}</span>
          {selectedOption?.hint ? <span className="select-trigger__hint">{selectedOption.hint}</span> : null}
        </span>
        <ChevronDown size={16} className="select-trigger__icon" />
      </button>

      <div className={`select-dropdown${open ? ' select-dropdown--open' : ''}`} role="listbox">
        {options.map((option) => {
          const active = option.value === value

          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={active}
              className={`select-option${active ? ' select-option--active' : ''}`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span className="select-option__copy">
                <span className="select-option__label">{option.label}</span>
                {option.hint ? <span className="select-option__hint">{option.hint}</span> : null}
              </span>
              {active ? <Check size={16} className="select-option__check" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
}: TextFieldProps) {
  return (
    <label className="form-field">
      <span className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <span className="form-field__description">{description}</span> : null}
      </span>
      <input
        className="text-input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function TextareaField({ label, description, value, onChange, placeholder }: TextareaFieldProps) {
  return (
    <label className="form-field">
      <span className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <span className="form-field__description">{description}</span> : null}
      </span>
      <textarea
        className="text-input text-input--textarea"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function ToggleSwitch({ label, description, checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-row${checked ? ' toggle-row--checked' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-row__copy">
        <span className="toggle-row__label">{label}</span>
        <span className="toggle-row__description">{description}</span>
      </span>
      <span className="toggle-row__track">
        <span className="toggle-row__thumb" />
      </span>
    </button>
  )
}
