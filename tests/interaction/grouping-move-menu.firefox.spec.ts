import { test } from '@playwright/test';
import { verifyGroupingMoveMenu } from './groupingMoveMenu.assertions';

test('grouping move menu opens and selects destinations in Firefox', async ({ page, baseURL }) => {
  await verifyGroupingMoveMenu(page, `${baseURL}/tests/interaction/grouping-move-menu.html`);
});
