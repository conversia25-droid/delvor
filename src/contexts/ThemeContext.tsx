import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ThemeMode = 'light' | 'dark' | 'whatsapp';

type ThemeContextType = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [theme, setThemeState] = useState<ThemeMode>('light');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (loading) return;

    const loadTheme = async () => {
      const localTheme = (localStorage.getItem('theme') as ThemeMode) || 'light';

      if (!user?.id) {
        setThemeState(localTheme);
        setInitialized(true);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('theme')
        .eq('id', user.id)
        .maybeSingle();

      if (!error && data?.theme) {
        const dbTheme = data.theme as ThemeMode;
        setThemeState(dbTheme);
        localStorage.setItem('theme', dbTheme);
      } else {
        setThemeState(localTheme);
      }

      setInitialized(true);
    };

    loadTheme();
  }, [user?.id, loading]);

  useEffect(() => {
    if (!initialized) return;

    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'whatsapp');

    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'whatsapp') {
      root.classList.add('whatsapp');
    } else {
      root.classList.add('light');
    }
  }, [theme, initialized]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);

    if (user?.id) {
      supabase
        .from('profiles')
        .update({ theme: newTheme })
        .eq('id', user.id)
        .then(({ error }) => {
          if (error) {
            console.error('Erro ao salvar tema do usuário:', error);
          }
        });
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
