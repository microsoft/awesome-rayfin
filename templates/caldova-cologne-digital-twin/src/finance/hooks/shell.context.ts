// Shell services the pages use: route state, undo/redo, the collapsible control
// pane, the variance palette and the command registry of the command palette.

import { createContext, useContext, useEffect } from 'react';

import type { PaletteId } from '@finance/lib/palette';
import type { PageId } from '@finance/lib/route';

export interface Command {
  id: string;
  group: string;
  label: string;
  /** Extra words the search should match (synonyms, codes). */
  keywords?: string;
  hint?: string;
  run: () => void;
}

export interface ShellContextValue {
  page: PageId;
  qs: string;
  setQs: (qs: string) => void;
  /** Same as setQs, but without a new undo step (defaults, migrations). */
  replaceQs: (qs: string) => void;
  go: (page: PageId, qs?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  copyLink: () => Promise<boolean>;
  paneOpen: boolean;
  setPaneOpen: (open: boolean) => void;
  palette: PaletteId;
  setPalette: (p: PaletteId) => void;
  registerCommands: (owner: string, commands: Command[]) => () => void;
  openPalette: () => void;
}

export const ShellContext = createContext<ShellContextValue | undefined>(undefined);

export function useShell(): ShellContextValue {
  const c = useContext(ShellContext);
  if (!c) throw new Error('useShell must be used inside the app shell');
  return c;
}

/** Registers page commands for the command palette while the page is mounted. */
export function usePageCommands(owner: string, commands: Command[]): void {
  const { registerCommands } = useShell();
  useEffect(() => registerCommands(owner, commands), [owner, commands, registerCommands]);
}
