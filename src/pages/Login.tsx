import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import BrandLogo from "@/components/BrandLogo";
import {
  Mail,
  Lock,
  User,
  Building2,
  FileText,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  MessageSquare,
  BarChart3,
  Zap,
  Shield,
  Eye,
  EyeOff,
  Gift,
  Phone,
} from "lucide-react";

type DocumentType = "CPF" | "CNPJ";

const Login = () => {
  const [mode, setMode] = useState<"login" | "signup">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("modo") === "cadastro" ? "signup" : "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("CPF");
  const [document, setDocument] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [signupStep, setSignupStep] = useState(0);
  const [affiliateCode, setAffiliateCode] = useState<string | null>(null);

  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Capturar código de afiliado da URL ou localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      const code = ref.trim().toUpperCase();
      setAffiliateCode(code);
      try { localStorage.setItem("crm:affiliate_ref", code); } catch {}
    } else {
      try {
        const saved = localStorage.getItem("crm:affiliate_ref");
        if (saved) setAffiliateCode(saved);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.document?.documentElement) {
      window.document.documentElement.classList.add("dark");
    }
  }, []);

  useEffect(() => { setSignupStep(0); }, [mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await login(email, password);
    if (!error) {
      const { data: profile } = await supabase.from("profiles").select("nome").eq("id", data.user?.id).maybeSingle();
      const profileNome = (profile as any)?.nome;
      toast({ title: profileNome ? `Bem-vindo de volta, ${profileNome}!` : "Login realizado com sucesso", description: profileNome ? "Que bom ter você aqui." : "Bem-vindo de volta!" });
      // Pega TODAS as roles do usuário (não só a primeira) — precisamos saber
      // se é "técnico puro" pra redirecionar pro app mobile.
      const { data: rolesData } = await supabase.from("user_roles").select("role").eq("user_id", data.user?.id);
      const roles = ((rolesData as any[]) ?? []).map((r: any) => r.role);
      const isSuperAdmin = roles.includes("super_admin");
      const isTecnico = roles.includes("tecnico");
      const isManager = roles.includes("admin") || roles.includes("gerente");

      const params = new URLSearchParams(window.location.search);
      const requested = params.get("next");
      // Prioridade do destino:
      //   1. ?next= explícito (deep link)
      //   2. super_admin → painel master
      //   3. técnico (puro OU técnico+vendedor) → app mobile (/m/orders)
      //      Vendedor sozinho sem técnico vai pro desktop normal — vende balcão.
      //   4. Demais (admin, gerente, vendedor, etc.) → dashboard desktop
      //
      // Quem é técnico (mesmo combinado com vendedor) tem o app mobile como
      // primeira opção porque o trabalho dele rola em campo. Ele pode mudar
      // pro desktop pelo botão "Versão desktop" no menu do PWA.
      const goesToMobile = isTecnico && !isManager;
      const next =
        requested
          ? requested
          : isSuperAdmin
            ? "/master"
            : goesToMobile
              ? "/m/orders"
              : "/dashboard";
      navigate(next);
    } else {
      toast({ title: "Erro ao fazer login", description: error.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const whatsappRaw = whatsapp.replace(/\D/g, "");
    const { error } = await signup(email, password, nome, companyName || nome, whatsappRaw || undefined);
    if (!error) {
      toast({ title: "Conta criada com sucesso!", description: "Você já pode fazer login." });
      setMode("login");
      setNome(""); setWhatsapp(""); setCompanyName(""); setPassword(""); setDocument(""); setDocumentType("CPF"); setSignupStep(0);
    } else {
      toast({ title: "Erro ao criar conta", description: error.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const canAdvanceStep = () => {
    if (signupStep === 0) return nome.trim().length >= 2 && email.includes("@");
    if (signupStep === 1) return password.length >= 6 && document.trim().length >= 11;
    return true;
  };

  const FEATURES = [
    { icon: MessageSquare, title: "WhatsApp integrado", desc: "Atendimento no mesmo lugar" },
    { icon: BarChart3, title: "Vendas & OS", desc: "Do orçamento à entrega" },
    { icon: Zap, title: "Estoque em tempo real", desc: "Baixa automática ao faturar" },
    { icon: Shield, title: "Seguro", desc: "Dados protegidos na nuvem" },
  ];

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-slate-950">

      {/* Background — glows sutis, sem grid centralizado */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950/40 to-slate-950" />
      <div className="absolute inset-0 opacity-25 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-blue-600 rounded-full blur-[140px]" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-600 rounded-full blur-[160px]" />
      </div>

      {/* Split-screen: brand à esquerda (desktop), form à direita */}
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_1fr]">

        {/* ═══════════ LADO ESQUERDO — brand + narrativa ═══════════ */}
        <div className="hidden lg:flex flex-col justify-center px-12 xl:px-20 border-r border-white/5 relative">
          {/* Detalhe decorativo — barra vertical fina no fim da coluna */}
          <div className="absolute right-0 top-1/4 bottom-1/4 w-px bg-gradient-to-b from-transparent via-blue-500/40 to-transparent" />

          <BrandLogo size={4.5} className="mb-10" />

          <h1 className="text-4xl xl:text-5xl font-bold text-white tracking-tight leading-[1.1]">
            Sua assistência técnica<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-sky-400">
              no controle.
            </span>
          </h1>

          <p className="mt-6 text-lg text-white/55 max-w-lg leading-relaxed">
            OS, vendas, estoque e WhatsApp em uma única plataforma
            pensada pra serviços de tecnologia.
          </p>

          {/* Features como lista vertical (não mais cards) */}
          <ul className="mt-12 space-y-5 max-w-md">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-4">
                <div className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-blue-500/10 ring-1 ring-blue-500/30 flex items-center justify-center">
                  <f.icon className="h-4 w-4 text-blue-300" />
                </div>
                <div>
                  <div className="font-semibold text-white text-[15px]">{f.title}</div>
                  <div className="text-sm text-white/45 mt-0.5">{f.desc}</div>
                </div>
              </li>
            ))}
          </ul>

          {/* Selos / social proof no rodapé da coluna */}
          <div className="mt-14 flex items-center gap-4 text-xs text-white/30">
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> LGPD-ready
            </span>
            <span className="opacity-40">·</span>
            <span>Backup diário</span>
            <span className="opacity-40">·</span>
            <span>Suporte via WhatsApp</span>
          </div>
        </div>

        {/* ═══════════ LADO DIREITO — form ═══════════ */}
        <div className="flex items-center justify-center p-4 sm:p-8 lg:p-12">
          <div className="w-full max-w-md">

            {/* Brand compacto — só no mobile (esquerda tá escondida) */}
            <div className="lg:hidden text-center mb-8">
              <BrandLogo size={2.5} />
              <p className="text-white/40 text-sm mt-3 max-w-xs mx-auto">
                Sua assistência técnica no controle.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-2xl shadow-blue-500/5 p-6 sm:p-8">

            {/* Header do card */}
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white">
                {mode === "login" ? "Acessar sua conta" : "Crie sua conta"}
              </h2>
              <p className="text-white/40 text-sm mt-1">
                {mode === "login"
                  ? "Entre com suas credenciais"
                  : `Passo ${signupStep + 1} de 3 — ${["Seus dados", "Segurança", "Sua empresa"][signupStep]}`
                }
              </p>
            </div>

            {/* ══════════ LOGIN ══════════ */}
            {mode === "login" && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/60">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                    <Input
                      type="email" placeholder="seu@email.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} disabled={loading} required
                      className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-white/60">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                    <Input
                      type={showPassword ? "text" : "password"} placeholder="Digite sua senha" value={password}
                      onChange={(e) => setPassword(e.target.value)} disabled={loading} required
                      className="pl-10 pr-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50 focus:ring-blue-500/20"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Checkbox id="remember" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked as boolean)} />
                    <Label htmlFor="remember" className="text-xs text-white/40 cursor-pointer">Manter conectado</Label>
                  </div>
                  <Link to="/forgot-password" className="text-xs text-blue-400 hover:text-blue-300 transition">Esqueceu a senha?</Link>
                </div>

                <Button type="submit" disabled={loading} className="w-full h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-lg shadow-blue-500/20 transition-all">
                  {loading ? "Entrando..." : "Entrar"}
                </Button>

                <p className="text-center text-sm text-white/30">
                  Não tem conta?{" "}
                  <button type="button" onClick={() => setMode("signup")} className="text-blue-400 hover:text-blue-300 font-medium transition">Criar conta</button>
                </p>
              </form>
            )}

            {/* ══════════ SIGNUP WIZARD ══════════ */}
            {mode === "signup" && (
              <div className="space-y-5">
                {/* Progress */}
                <div className="flex items-center gap-2">
                  {[0, 1, 2].map((step) => (
                    <div key={step} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                      step < signupStep ? "bg-green-500" : step === signupStep ? "bg-blue-500" : "bg-white/10"
                    }`} />
                  ))}
                </div>

                <form onSubmit={handleSignup}>
                  {/* Step 0 */}
                  {signupStep === 0 && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">Seu nome completo</Label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                          <Input autoFocus placeholder="Como quer ser chamado" value={nome} onChange={(e) => setNome(e.target.value)} disabled={loading}
                            className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                          <Input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading}
                            className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">WhatsApp</Label>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                          <Input type="tel" placeholder="(00) 00000-0000" value={whatsapp}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                              const formatted = raw.length <= 2 ? raw
                                : raw.length <= 7 ? `(${raw.slice(0, 2)}) ${raw.slice(2)}`
                                : `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
                              setWhatsapp(formatted);
                            }}
                            disabled={loading}
                            className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 1 */}
                  {signupStep === 1 && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">Crie uma senha</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                          <Input autoFocus type={showPassword ? "text" : "password"} placeholder="Mínimo 6 caracteres" value={password}
                            onChange={(e) => setPassword(e.target.value)} disabled={loading} minLength={6}
                            className="pl-10 pr-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50" />
                          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition">
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        {password && (
                          <div className="flex gap-1 mt-1">
                            {[1, 2, 3, 4].map((level) => (
                              <div key={level} className={`h-1 flex-1 rounded-full transition-all ${
                                password.length >= level * 3 ? level <= 2 ? "bg-red-500" : level === 3 ? "bg-yellow-500" : "bg-green-500" : "bg-white/10"
                              }`} />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">Tipo de cadastro</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {(["CPF", "CNPJ"] as DocumentType[]).map((type) => (
                            <button key={type} type="button" onClick={() => setDocumentType(type)}
                              className={`h-10 rounded-lg border text-sm font-medium transition-all ${
                                documentType === type ? "bg-blue-600/20 border-blue-500 text-blue-400" : "bg-white/5 border-white/10 text-white/50 hover:border-white/20"
                              }`}
                            >
                              {type === "CPF" ? "Pessoa Física" : "Pessoa Jurídica"}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">{documentType}</Label>
                        <div className="relative">
                          <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                          <Input placeholder={documentType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"} value={document} onChange={(e) => setDocument(e.target.value)} disabled={loading}
                            className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 2 */}
                  {signupStep === 2 && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-white/60">Nome da sua empresa</Label>
                        <div className="relative">
                          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                          <Input autoFocus placeholder="Nome da empresa ou seu nome" value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={loading}
                            className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/50" />
                        </div>
                        <p className="text-[10px] text-white/20">Pode ser alterado depois nas configurações</p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                        <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Resumo</p>
                        {[
                          nome,
                          email,
                          `${documentType}: ${document}`,
                          companyName || null
                        ].filter(Boolean).map((item, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-white/70">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            <span className="truncate">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Navegação */}
                  <div className="flex gap-3 mt-6">
                    {signupStep > 0 && (
                      <Button type="button" variant="outline" onClick={() => setSignupStep((s) => s - 1)}
                        className="h-11 bg-white/5 border-white/10 text-white hover:bg-white/10">
                        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                      </Button>
                    )}
                    {signupStep < 2 ? (
                      <Button type="button" disabled={!canAdvanceStep()} onClick={() => setSignupStep((s) => s + 1)}
                        className="flex-1 h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-lg shadow-blue-500/20">
                        Continuar <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <Button type="submit" disabled={loading}
                        className="flex-1 h-11 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-medium shadow-lg shadow-green-500/20">
                        {loading ? "Criando conta..." : "Criar minha conta"}
                      </Button>
                    )}
                  </div>
                </form>

                {/* Código de afiliado */}
                {affiliateCode && (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-2.5">
                    <Gift className="h-4 w-4 text-blue-400 shrink-0" />
                    <span className="text-xs text-blue-300">
                      Código de indicação: <span className="font-bold text-blue-200">{affiliateCode}</span>
                    </span>
                  </div>
                )}

                <p className="text-center text-sm text-white/30">
                  Já tem conta?{" "}
                  <button type="button" onClick={() => setMode("login")} className="text-blue-400 hover:text-blue-300 font-medium transition">Fazer login</button>
                </p>
              </div>
            )}
            </div>

            {/* Footer (dentro da coluna do form) */}
            <p className="text-center text-[11px] text-white/25 mt-6">
              Ao continuar, você concorda com os{" "}
              <Link to="/termos" className="hover:text-white/50 underline transition">Termos de Uso</Link>
              {" "}e a{" "}
              <Link to="/privacidade" className="hover:text-white/50 underline transition">Política de Privacidade</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
