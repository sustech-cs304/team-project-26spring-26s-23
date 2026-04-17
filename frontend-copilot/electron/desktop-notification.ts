export const DESKTOP_NOTIFICATION_SHOW_CHANNEL = 'desktop-notification:show'

export interface DesktopNotificationRequest {
  title: string
  body: string
  tag?: string
}

export interface DesktopNotificationApi {
  show: (request: DesktopNotificationRequest) => Promise<void>
}
