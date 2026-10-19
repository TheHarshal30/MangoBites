import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem('theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* storage unavailable */ }
  return 'system';
}

const resolve = (p: ThemePreference): Resolved => (p === 'system' ? (media().matches ? 'dark' : 'light') : p);

/** Applied before React mounts so there is no light flash on a dark system. */
export function applyInitialTheme() {
  document.documentElement.classList.toggle('dark', resolve(readPreference()) === 'dark');
}

const ThemeContext = createContext<{ preference: ThemePreference; resolved: Resolved; setPreference: (p: ThemePreference) => void }>({
  preference: 'system',
  resolved: 'light',
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const on = () => setSystemDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const resolved: Resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark'); }, [resolved]);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    try {
      if (p === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', p);
    } catch { /* ignore */ }
  };

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
