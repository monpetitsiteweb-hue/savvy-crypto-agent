import { Page } from '@playwright/test';

export function guardConsole(page: Page) {
  const forbidden = new Set(['log','debug','info','trace']);
  page.on('console', msg => {
    const type = msg.type();
    if (forbidden.has(type)) {
      throw new Error(`Forbidden console ${type}: ${msg.text()}`);
    }
  });
}