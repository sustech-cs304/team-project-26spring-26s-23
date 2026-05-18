/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CopilotMessageList } from './CopilotMessageList'
import type { CopilotMessageListItem } from './run-segment-view-model'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

describe('CopilotMessageList inline form interactions', () => {
  it('keeps local draft values across ordinary parent rerenders for the same pending form', async () => {
    const rendered = renderWithRoot(
      <CopilotMessageList
        conversation={[createInlineFormConversationItem({ formValues: { courseCode: '' } })]}
      />,
    )

    const field = rendered.getByTestId('chat-message-inline-form-field-courseCode-0').querySelector('input') as HTMLInputElement
    await setFormControlValue(field, 'CS304')

    await act(async () => {
      rendered.root.render(
        <CopilotMessageList
          conversation={[createInlineFormConversationItem({ formValues: { courseCode: '' } })]}
        />,
      )
    })

    const fieldAfterRerender = rendered.getByTestId('chat-message-inline-form-field-courseCode-0').querySelector('input') as HTMLInputElement
    expect(fieldAfterRerender.value).toBe('CS304')

    rendered.unmount()
  })
})

function createInlineFormConversationItem(input: {
  formValues: Record<string, string | number | boolean>
}): CopilotMessageListItem {
  return {
    id: 'inline-form:run-form:tool.request-user-form:call-1',
    kind: 'inline-form',
    runId: 'run-form',
    sequence: 1,
    status: 'completed',
    toolCallId: 'tool.request-user-form:call-1',
    toolId: 'tool.request-user-form',
    formId: 'course-form',
    title: '请求课程表单',
    content: '请填写课程编码。',
    description: null,
    submitLabel: '提交',
    fields: [{
      name: 'courseCode',
      label: '课程编码',
      type: 'text',
      required: true,
    }],
    formState: 'pending',
    formValues: { ...input.formValues },
    submittedPayload: null,
  }
}

function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    root,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target as HTMLElement
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
