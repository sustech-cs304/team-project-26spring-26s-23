import { act } from 'react'

export async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export async function blurElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false }))
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: false }))
  })
}

export async function inputText(element: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
  })
}

export async function keyDownElement(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
  })
}

export async function openContextMenu(element: Element, clientX: number, clientY: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
  })
}

export async function hoverElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  })
}
