export const isTrustedDesktopUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'media-organizer:' && parsed.hostname === 'app';
  } catch {
    return false;
  }
};
