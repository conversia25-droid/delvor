import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/* ================= TYPES ================= */

type UserRole = 'super_admin' | 'admin' | 'gerente' | 'vendedor' | 'tecnico' | 'user' | string;
type Tenant = 'prod' | 'local' | 'vps1';
type ThemeMode = 'light' | 'dark' | 'whatsapp';

type User = {
  id: string;
  nome: string;
  email: string;
  roles: UserRole[];
  company_id: string | null;
  company_name?: string;
  vertical?: string;
  theme?: ThemeMode;
};

type AuthContextType = {
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  tenant: Tenant;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: any }>;
  signup: (email: string, password: string, nome: string, companyName: string, whatsapp?: string) => Promise<{ error: any }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  setTenant: (tenant: Tenant) => void;
  hasRole: (role: UserRole) => boolean;
  /** true para admin E gerente — acesso a dados completos, sem acesso a config */
  isManager: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenantState] = useState<Tenant>(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('tenant') as Tenant) : null;
    return saved && ['prod', 'local', 'vps1'].includes(saved) ? saved : 'prod';
  });

  const loadUserProfile = async (supabaseUser: SupabaseUser) => {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(`
          nome,
          email,
          company_id,
          theme,
          companies (
            name,
            vertical
          )
        `)
        .eq('id', supabaseUser.id)
        .single();

      if (profileError) throw profileError;

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', supabaseUser.id);

      setUser({
        id: supabaseUser.id,
        nome: profile?.nome || 'Usuário',
        email: profile?.email || supabaseUser.email || '',
        roles: userRoles?.map((r) => r.role as UserRole) || ['user'],
        company_id: profile?.company_id || null,
        company_name: (profile?.companies as any)?.name || '',
        vertical: (profile?.companies as any)?.vertical || 'assistencia_tecnica',
        theme: ((profile as any)?.theme || 'light') as ThemeMode,
      });
    } catch (error: any) {
      console.error('AuthContext: Erro ao carregar perfil:', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) loadUserProfile(session.user);
      else setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) loadUserProfile(session.user);
      else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    return await supabase.auth.signInWithPassword({ email, password });
  };

  const signup = async (email: string, password: string, nome: string, companyName: string, whatsapp?: string) => {
    // Resetar onboarding para novo cadastro
    try {
      window.dispatchEvent(new Event("onboarding-reset"));
    } catch {}

    // Cria a empresa via RPC SECURITY DEFINER (anon não pode SELECT em companies).
    const { data: companyId, error: companyError } = await supabase.rpc(
      'signup_create_company' as any,
      { p_name: companyName }
    );

    if (companyError) return { error: companyError };
    if (!companyId) return { error: new Error('Falha ao criar empresa') };

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nome,
          company_id: companyId,
        },
      },
    });

    if (error) return { error };

    const userId = data.user?.id;
    if (!userId) {
      return {
        error: new Error(
          'Usuário criado, mas não foi possível obter o ID para concluir o bootstrap (profiles/user_roles).'
        ),
      };
    }

    // Schema Delvor: profile já é criado pelo trigger handle_new_user.
    // Aqui só preenchemos os campos extras (nome, telefone, company_id).
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: userId,
          email,
          nome,
          phone: whatsapp || null,
          company_id: companyId,
          theme: 'light',
        } as any,
        { onConflict: 'id' }
      );

    if (profileError) return { error: profileError };

    // user_roles tem PK composta (user_id, role, company_id) — passamos os 3.
    const { error: roleError } = await supabase
      .from('user_roles')
      .upsert(
        { user_id: userId, role: 'admin', company_id: companyId } as any,
        { onConflict: 'user_id,role,company_id' }
      );

    if (roleError) return { error: roleError };

    return { error: null };
  };

  const logout = async () => {
    // Limpa estado local primeiro para evitar UI "presa" na sessão antiga
    setUser(null);
    setSession(null);

    try {
      // scope 'local' encerra apenas esta sessão/dispositivo e remove o token do localStorage
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      console.warn('signOut falhou, limpando token manualmente:', err);
    }

    // Garantia: remove qualquer token residual do Supabase no localStorage
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
          localStorage.removeItem(k);
        }
      });
    } catch {}

    // Força o navegador a ir para /login em uma página limpa (sem cache em memória)
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
  };

  const resetPassword = async (email: string) => {
    // Usa a origem atual do navegador — funciona local, staging e produção sem mudar código.
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/update-password`
        : '/update-password';
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error };
  };

  const setTenant = (t: Tenant) => {
    setTenantState(t);
    localStorage.setItem('tenant', t);
  };

  const hasRole = (role: UserRole) => user?.roles.includes(role) || false;
  const isManager = hasRole('admin') || hasRole('gerente');

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!session,
        user,
        session,
        tenant,
        loading,
        login,
        signup,
        logout,
        resetPassword,
        setTenant,
        hasRole,
        isManager,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
