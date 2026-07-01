import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dictionaries, languages } from '../src/i18n';

test('registered locale dictionaries expose the same translation keys', () => {
  const [defaultLanguage] = languages;
  const defaultKeys = Object.keys(dictionaries[defaultLanguage.locale]).sort();

  for (const language of languages) {
    const keys = Object.keys(dictionaries[language.locale]).sort();
    assert.deepEqual(keys, defaultKeys, `${language.locale} dictionary should match the default key set`);
  }
});
