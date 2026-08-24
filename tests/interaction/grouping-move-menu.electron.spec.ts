import path from 'node:path';
import { test, _electron as electron } from '@playwright/test';
import { verifyGroupingMoveMenu } from './groupingMoveMenu.assertions';

test('grouping move menu opens and selects destinations in Electron', async ({ baseURL }) => {
  const electronApp = await electron.launch({
    args: [path.resolve('tests/interaction/support/electron-main.cjs')],
    env: {
      ...process.env,
      MEDIA_ORGANIZER_INTERACTION_URL: `${baseURL}/tests/interaction/grouping-move-menu.html`
    }
  });

  try {
    const window = await electronApp.firstWindow();
    await verifyGroupingMoveMenu(window, `${baseURL}/tests/interaction/grouping-move-menu.html`);
  } finally {
    await electronApp.close();
  }
});
