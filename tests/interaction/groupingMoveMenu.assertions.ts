import { expect, type Page } from '@playwright/test';

export const verifyGroupingMoveMenu = async (page: Page, fixtureUrl: string) => {
  await page.goto(fixtureUrl);

  const trigger = page.getByRole('button', { name: 'Move selected' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const menu = page.getByRole('menu', { name: 'Move selected' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Family album', 'Preserved trips']);

  await menu.getByRole('menuitem', { name: 'Preserved trips' }).click();
  await expect(page.getByTestId('selected-destination')).toHaveText('preserved:trips');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Family album' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Preserved trips' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole('button', { name: 'Outside control' }).click();
  await expect(menu).toBeHidden();

  await trigger.focus();
  await trigger.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-destination')).toHaveText('folder:family');
  await expect(menu).toBeHidden();

  await trigger.focus();
  await trigger.press('Space');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('selected-destination')).toHaveText('folder:family');
  await expect(menu).toBeHidden();

  const previewTrigger = page.getByRole('button', { name: 'Move preview' });
  await previewTrigger.click();
  await expect(page.getByRole('menu', { name: 'Move preview' })).toBeVisible();
  await page.getByRole('menu', { name: 'Move preview' }).getByRole('menuitem', { name: 'Family album' }).click();
  await expect(page.getByTestId('selected-destination')).toHaveText('folder:family');

  await expect(page.getByRole('button', { name: 'No destinations' })).toBeDisabled();
};
