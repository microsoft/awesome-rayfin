import { useCallback, useEffect, useState } from 'react';

import { useUm } from '@/um/hooks/UmContext';

import { NO_CONVENTIONS, SETTING_GUIDELINES, readConventions, type Conventions } from './conventions';

/**
 * The organization's conventions as stored. Unset and unreachable both read
 * as "nothing set": the guidelines then show the standard.
 */
export function useConventions(): { conventions: Conventions; loaded: boolean; reload: () => Promise<Conventions> } {
  const { services } = useUm();
  const [state, setState] = useState<{ conventions: Conventions; loaded: boolean }>({ conventions: NO_CONVENTIONS, loaded: false });

  const reload = useCallback(async () => {
    const conventions = readConventions(await services.store.getSetting(SETTING_GUIDELINES).catch(() => undefined));
    setState({ conventions, loaded: true });
    return conventions;
  }, [services]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
