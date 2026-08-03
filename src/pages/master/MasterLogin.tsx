import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function MasterLogin() {
  const { login, hasRole, loading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated && hasRole("super_admin")) {
      navigate("/master", { replace: true });
    }
  }, [loading, isAuthenticated, hasRole, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await login(email, password);

    if (error) {
      toast({ title: "Falha no acesso", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    setTimeout(() => {
      if (hasRole("super_admin")) {
        navigate("/master", { replace: true });
      } else {
        toast({
          title: "Acesso negado",
          description: "Esta conta não possui permissão de super administrador.",
          variant: "destructive",
        });
        navigate("/dashboard", { replace: true });
      }
      setSubmitting(false);
    }, 500);
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 flex items-center justify-center">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-300">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <div>
            <CardTitle className="text-2xl">Painel Master</CardTitle>
            <CardDescription className="text-slate-400">
              Área isolada para comunicados globais e administração do sistema.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="master-email">Email</Label>
              <Input id="master-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="master-password">Senha</Label>
              <Input id="master-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Entrando..." : "Entrar no painel master"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
