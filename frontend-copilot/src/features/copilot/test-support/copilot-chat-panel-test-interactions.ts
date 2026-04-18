import { act } from 'react'

export async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

export async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter')
  }

  await act(async () => {
    const previousValue = element.value
    valueSetter.call(element, value)
    const tracker = (element as HTMLInputElement & { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker
    tracker?.setValue(previousValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function submitForm(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

export async function pressTextareaKey(
  element: HTMLTextAreaElement,
  key: string,
  options: Partial<KeyboardEventInit> = {},
) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options }))
  })
}

export async function dragComposerResizeHandle(element: HTMLDivElement, startY: number, endY: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientY: startY }))
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientY: endY }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientY: endY }))
  })
}
