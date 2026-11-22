import type {LcdScreen, SavedScreen} from '../types.ts';

export function screenSignature(screen: LcdScreen): string {
  return JSON.stringify({
    name: screen.name.trim(),
    durationSec: screen.durationSec,
    transition: screen.transition,
    backgroundType: screen.backgroundType,
    backgroundColor: screen.backgroundColor,
    backgroundImage: screen.backgroundImage ?? null,
    backgroundDim: screen.backgroundDim,
    themeId: screen.themeId ?? null,
    widgets: screen.widgets,
  });
}

export function isScreenUnsaved(screen: LcdScreen, savedScreens: SavedScreen[]): boolean {
  const sig = screenSignature(screen);
  return !savedScreens.some((saved) => screenSignature(saved.screen) === sig);
}

export function upsertSavedScreen(
  savedScreens: SavedScreen[],
  screen: LcdScreen,
  customName?: string
): {nextSavedScreens: SavedScreen[]; nextScreenName: string} {
  const nextScreenName = (customName ?? screen.name).trim() || screen.name || 'Untitled Screen';
  const snapshot: LcdScreen = {
    ...structuredClone(screen),
    name: nextScreenName,
  };

  const existingIdx = savedScreens.findIndex(
    (item) =>
      item.screen.id === screen.id ||
      item.name.trim().toLowerCase() === nextScreenName.toLowerCase()
  );

  if (existingIdx >= 0) {
    const updated = [...savedScreens];
    updated[existingIdx] = {
      ...updated[existingIdx],
      name: nextScreenName,
      savedAt: new Date().toISOString(),
      screen: snapshot,
    };
    return {nextSavedScreens: updated, nextScreenName};
  }

  const entry: SavedScreen = {
    id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: nextScreenName,
    savedAt: new Date().toISOString(),
    screen: snapshot,
  };
  return {
    nextSavedScreens: [entry, ...savedScreens],
    nextScreenName,
  };
}
