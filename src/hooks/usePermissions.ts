import { useAuth } from "@/contexts/AuthContext";

/**
 * Hook centralizado de permissões da UI.
 *
 * Importante: o RLS no banco já bloqueia acessos indevidos. Estas flags
 * servem só para *esconder* botões/menus que o usuário não pode usar,
 * evitando o desconforto de clicar e receber erro.
 *
 * Regra de papéis:
 *  - admin    → tudo
 *  - gerente  → tudo, exceto Configurações críticas
 *  - vendedor → suas vendas + suas OS (que ele abriu) + WhatsApp dele
 *  - tecnico  → só OS atribuídas a ele
 *  - user     → tratado como vendedor (legado, ainda funciona)
 */
export function usePermissions() {
  const { user, hasRole } = useAuth();

  const isSuper       = hasRole("super_admin");
  const isAdmin       = hasRole("admin")    || isSuper;
  const isGerente     = hasRole("gerente");
  const isVendedor    = hasRole("vendedor") || hasRole("user");
  const isTecnico     = hasRole("tecnico");
  const isFinanceiro  = hasRole("financeiro");

  /** admin OU gerente — quem tem visão completa da empresa */
  const isManager = isAdmin || isGerente;

  /** admin, gerente OU financeiro — quem pode operar o add-on financeiro */
  const hasFinancialAccess = isManager || isFinanceiro;

  /**
   * "Técnico puro" — só tem o papel de técnico, sem vendedor/admin/gerente.
   * Esses usuários NÃO veem informações financeiras (custos, preços de venda,
   * valor em estoque, faturamento).
   */
  const isPureTechnician = isTecnico && !isManager && !isVendedor;
  const canSeePricing = !isPureTechnician;

  return {
    user,
    isSuper,
    isAdmin,
    isGerente,
    isVendedor,
    isTecnico,
    isFinanceiro,
    isManager,
    hasFinancialAccess,
    isPureTechnician,
    canSeePricing,

    // ----- VENDAS -----
    canViewSales: isManager || isVendedor,
    canCreateSale: isManager || isVendedor,
    canEditAllSales: isManager,
    canTransferSale: true, // RPC valida server-side se é dono ou manager
    canApproveSale: isManager || isVendedor, // vendedor aprova as próprias
    canInvoiceSale: isManager || isVendedor,

    // ----- OS -----
    canViewAllOs: isManager,
    canCreateOs: isManager || isVendedor || isTecnico, // técnico pode abrir OS interna se quiser
    canAssignTechnician: isManager || isVendedor,       // vendedor atribui ao criar
    canEditAllOs: isManager,
    canTransferOs: true, // RPC valida server-side
    canConvertOsToSale: isManager || isVendedor,        // técnico não fatura
    canCloseOs: true, // todos podem mudar status até onde a transição permite (server-side decide)

    // ----- ESTOQUE / CADASTROS -----
    canManageStock: isManager,                          // CRUD de produtos / mov. manual
    canManageSuppliers: isManager,
    canManagePurchases: isManager,
    canManageServicesCatalog: isManager,
    canManageProductCategories: isManager,

    // ----- LOCAÇÕES -----
    canViewRentals: isManager || isVendedor || isTecnico,
    /** Vendedor cria contrato; técnico não. */
    canCreateRental: isManager || isVendedor,
    /** Só admin/gerente fatura. Vendedor pode ver, mas não gera. */
    canGenerateRentalInvoice: isManager,
    /** Cliente interno (ativos da casa) só admin/gerente cria/marca. */
    canManageInternalCustomers: isManager,

    // ----- EQUIPE / CONFIG -----
    canManageTeam: isAdmin,
    canViewSettings: isAdmin,
    canViewReports: isManager || isVendedor || isTecnico, // todos veem; o que é mostrado varia (filtra por role)
    canViewWallboard: isManager,
  };
}
