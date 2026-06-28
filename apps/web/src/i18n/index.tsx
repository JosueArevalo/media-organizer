import React, { createContext, useContext, useMemo, useState } from 'react';
import { en } from './locales/en';
import { es } from './locales/es';
import type { LanguageOption, Locale, TranslationDictionary, TranslationKey, TranslationParams } from './types';

const STORAGE_KEY = 'mediaOrganizer.locale';
const DEFAULT_LOCALE: Locale = 'en';

export const languages: LanguageOption[] = [
  { locale: 'en', label: 'English', shortLabel: 'EN' },
  { locale: 'es', label: 'Español', shortLabel: 'ES' }
];

export const dictionaries: Record<Locale, TranslationDictionary> = {
  en,
  es
};

const isLocale = (value: string | null): value is Locale =>
  Boolean(value && languages.some((language) => language.locale === value));

export const getStoredLocale = (): Locale => {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  try {
    const storedLocale = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

const persistLocale = (locale: Locale) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Locale persistence should never block rendering.
  }
};

const interpolate = (template: string, params?: TranslationParams) => {
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
};

type I18nContextValue = {
  locale: Locale;
  currentLanguage: LanguageOption;
  languages: LanguageOption[];
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider = ({ children }: { children: React.ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());

  const value = useMemo<I18nContextValue>(() => {
    const currentLanguage = languages.find((language) => language.locale === locale) ?? languages[0];

    return {
      locale,
      currentLanguage,
      languages,
      setLocale: (nextLocale) => {
        setLocaleState(nextLocale);
        persistLocale(nextLocale);
      },
      t: (key, params) => interpolate(dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key], params)
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useTranslation = () => {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider.');
  }

  return context;
};

export type { Locale, TranslationDictionary, TranslationKey };
