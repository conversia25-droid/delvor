import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import BrandLogo from "@/components/BrandLogo";

const UpdatePassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Lendo token de segurança...");
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const processDirectToken = async () => {
      // 1. Pega o token direto da URL que o e-mail mandou
      const params = new URLSearchParams(window.location.search);
      const token_hash = params.get("token_hash");

      if (token_hash) {
        // 2. Faz a verificação diretamente pelo Front-end (Bypass da API)
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash,
          type: 'recovery'
        });

        if (error) {
          setStatusMsg("Erro no link: " + error.message);
          return;
        }

        if (data.session) {
          setHasSession(true);
          setStatusMsg("");
          // Limpa a URL para ficar bonita
          window.history.replaceState(null, "", "/update-password");
        }
      } else {
        // Fallback: se não tiver token, verifica se já estava logado
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setHasSession(true);
          setStatusMsg("");
        } else {
          setStatusMsg("Link sem token. Por favor, peça um novo e-mail.");
        }
      }
    };

    processDirectToken();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      return toast({ title: "Erro", description: "As senhas não coincidem.", variant: "destructive" });
    }
    if (password.length < 6) {
      return toast({ title: "Erro", description: "A senha precisa ter no mínimo 6 caracteres.", variant: "destructive" });
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (!error) {
      toast({ title: "Sucesso!", description: "Sua senha foi atualizada com sucesso!" });
      setTimeout(() => navigate("/login"), 2000);
    } else {
      // 🔹 AGORA MOSTRAMOS O ERRO REAL DO SUPABASE
      toast({ 
        title: "Falha ao salvar", 
        description: error.message, 
        variant: "destructive" 
      });
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 p-4 flex-col">
      <Card className="w-full max-w-md bg-background/95 backdrop-blur-sm border-blue-500/20">
        <CardHeader className="space-y-4 flex flex-col items-center">
          <div className="relative mx-auto mb-4 bg-blue-900 px-6 py-3 rounded">
            <BrandLogo size={2.5} />
          </div>
          <CardTitle className="text-2xl font-bold">Nova Senha</CardTitle>
          <CardDescription>Crie uma nova senha de acesso.</CardDescription>
        </CardHeader>
        <CardContent>
          
          {/* Mostra as mensagens de status do carregamento */}
          {!hasSession && (
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-500 text-sm text-center">
              {statusMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                disabled={!hasSession || loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                required
                disabled={!hasSession || loading}
              />
            </div>
            <Button type="submit" className="w-full bg-blue-700 hover:bg-blue-800" disabled={!hasSession || loading}>
              {loading ? "Salvando..." : "Atualizar Senha"}
            </Button>
          </form>

        </CardContent>
      </Card>
    </div>
  );
};

export default UpdatePassword;