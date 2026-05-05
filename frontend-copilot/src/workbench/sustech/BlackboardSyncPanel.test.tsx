/** @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BlackboardSyncPanel } from './BlackboardSyncPanel'

function idleSync() {
  return { status: 'idle' as const, lastSyncAt: null, nextSyncAt: null, lastSyncError: null, syncInterval: 'off', progressMessage: null, progressStage: null, progressLogs: [], canCancel: false, timeoutSeconds: null }
}

function runningSync() {
  return {
    status: 'running' as const,
    lastSyncAt: null,
    nextSyncAt: null,
    lastSyncError: null,
    syncInterval: 'off',
    progressMessage: '抓取课程列表',
    progressStage: 'fetching_courses',
    progressLogs: ['使用 CASClient 认证', '抓取课程列表'],
    canCancel: true,
    timeoutSeconds: 480,
  }
}

function completedSync() {
  return { status: 'completed' as const, lastSyncAt: '2026-04-30T10:00:00Z', nextSyncAt: null, lastSyncError: null, syncInterval: 'off', progressMessage: null, progressStage: null, progressLogs: [], canCancel: false, timeoutSeconds: null }
}

function failedSync() {
  return { status: 'failed' as const, lastSyncAt: null, nextSyncAt: null, lastSyncError: 'CAS 登录失败', syncInterval: 'off', progressMessage: null, progressStage: null, progressLogs: [], canCancel: false, timeoutSeconds: null }
}

describe('BlackboardSyncPanel', () => {
  it('hides idle state so it does not occupy layout space', () => {
    const html = renderToStaticMarkup(
      <BlackboardSyncPanel language="zh-CN" syncState={idleSync()} />,
    )
    expect(html).toBe('')
  })

  it('renders running state with progress stages and message', () => {
    const html = renderToStaticMarkup(
      <BlackboardSyncPanel language="zh-CN" syncState={runningSync()} onCancelSync={() => {}} />,
    )
    expect(html).toContain('同步中…')
    expect(html).toContain('认证')
    expect(html).toContain('课程列表')
    expect(html).toContain('抓取课程列表')
    expect(html).toContain('日志详情')
    expect(html).toContain('使用 CASClient 认证')
    expect(html).toContain('取消')
  })

  it('hides completed state after sync finishes', () => {
    const html = renderToStaticMarkup(
      <BlackboardSyncPanel language="zh-CN" syncState={completedSync()} />,
    )
    expect(html).toBe('')
  })

  it('hides failed state after sync stops', () => {
    const html = renderToStaticMarkup(
      <BlackboardSyncPanel language="zh-CN" syncState={failedSync()} />,
    )
    expect(html).toBe('')
  })

  it('renders in English while running', () => {
    const html = renderToStaticMarkup(
      <BlackboardSyncPanel language="en-US" syncState={runningSync()} onCancelSync={() => {}} />,
    )
    expect(html).toContain('Sync Status')
    expect(html).toContain('Syncing…')
  })
})
