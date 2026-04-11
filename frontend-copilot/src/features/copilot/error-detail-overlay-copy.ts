import type {
  ErrorDetailOverlayContentItem,
  ErrorDetailOverlayGroup,
  ErrorDetailOverlayViewModel,
} from './error-detail-overlay-view-model'

export function formatErrorDetailOverlayCopyText(
  viewModel: ErrorDetailOverlayViewModel,
): string {
  const renderedGroups = viewModel.groups
    .map((group) => formatErrorDetailOverlayGroupCopyText(group))
    .filter((value) => value.trim() !== '')

  return [
    '错误详情',
    '',
    ...renderedGroups.flatMap((groupText, index) => index === 0 ? [groupText] : ['', groupText]),
  ].join('\n').trim()
}

export function formatErrorDetailOverlayGroupCopyText(
  group: ErrorDetailOverlayGroup,
): string {
  const renderedItems = group.items
    .flatMap((item) => formatContentItem(item))
    .filter((value) => value.trim() !== '')

  return [`[${group.title}]`, ...renderedItems].join('\n').trim()
}

export async function copyErrorDetailOverlaySummary(
  viewModel: ErrorDetailOverlayViewModel,
): Promise<boolean> {
  return copyTextToClipboard(formatErrorDetailOverlayCopyText(viewModel))
}

export async function copyErrorDetailOverlayGroup(
  group: ErrorDetailOverlayGroup,
): Promise<boolean> {
  return copyTextToClipboard(formatErrorDetailOverlayGroupCopyText(group))
}

function formatContentItem(item: ErrorDetailOverlayContentItem): string[] {
  switch (item.kind) {
    case 'key-value':
      return [`${item.label}: ${item.value}`]
    case 'list':
      return item.values.length === 0 ? [] : [`${item.label}: ${item.values.join(', ')}`]
    case 'text': {
      const trimmedText = item.text.trim()
      if (trimmedText === '') {
        return []
      }

      return item.label === null
        ? [trimmedText]
        : [`${item.label}:`, trimmedText]
    }
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('clipboard-unavailable')
    }

    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
