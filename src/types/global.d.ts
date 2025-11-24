// Global type augmentations

declare global {
  interface Window {
    NotificationSink?: {
      log: (data: any) => void;
    };
  }
}

export {};
