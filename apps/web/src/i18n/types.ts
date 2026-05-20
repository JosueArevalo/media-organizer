import type { en } from './locales/en';

export type Locale = 'en' | 'es';
export type TranslationKey = keyof typeof en;
export type TranslationDictionary = Record<TranslationKey, string>;

export type TranslationParams = Record<string, string | number>;

export type LanguageOption = {
  locale: Locale;
  label: string;
  shortLabel: string;
  flag: string;
};
