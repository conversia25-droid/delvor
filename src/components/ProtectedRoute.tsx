import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireSuperAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireSuperAdmin = false,
}: ProtectedRouteProps) {
  const { isAuthenticated, hasRole, loading } = useAuth();

  // ⏳ Enquanto o Auth está hidratando, NÃO redireciona
  if (loading) {
    return null;
  }

  // 🔐 Depois que loading termina, aí sim valida
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireSuperAdmin && !hasRole("super_admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdmin && !hasRole("admin") && !hasRole("super_admin")) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
