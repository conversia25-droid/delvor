import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Eye, ArrowDown, ArrowUp, X, User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function InboxSidebar({ ctx }: { ctx: any }) {
  const {
    isMobile, showChat, sidebarWidth, tagFilterId, setTagFilterId, tagsCatalog, loadingTagFilter,
    search, setSearch, onlyUnread, setOnlyUnread, isAdmin, isManager, leadSelectMode, setLeadSelectMode,
    setSelectedLeadJids, selectedLeadJids, bulkDeleteSelectedJids, clearSelection, leadSortOrder,
    setLeadSortOrder, unreadLoaded, hiddenJids, setShowHiddenDialog, urlUserFilter, adminUserFilter,
    setAdminUserFilter, teamUsers, adminFunnelFilter, setAdminFunnelFilter, funnels, unreadStats,
    leadListRef, setLeadListLimit, orderedLeads, leadListLimit, lastMessageByLead, unreadByJid,
    normalizeJid, buildConversationKey, pulseMap, currentLead, leadRowRefMap, toggleSelectJid,
    setIsSwitchingChat, setLeadMeta, setShowSummary, setCurrentLead, setTargetMsgId,
    ensureConversationLoaded, loadLeadMeta, setJidInUrl, setShowChat, openContextMenu, leadCache,
    leadMeta, openAddUserDialogByJid, formatListDate, renderAck, WhatsAppLogo,
  } = ctx;
  return (
{(!isMobile || !showChat) && (
        <div style={!isMobile ? { width: sidebarWidth } : undefined} className={`w-full md:min-w-[340px] md:max-w-[800px] flex flex-col gap-4 h-full overflow-hidden border-r`} >
        <div className="flex flex-col gap-1 px-4 pt-4">
          <label className="text-xs opacity-70">Filtrar por tag</label>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={tagFilterId} onChange={(e) => setTagFilterId(e.target.value)} >
            <option value="">Todas as conversas</option>
            {tagsCatalog.map((t) => ( <option key={t.id} value={t.id}> {t.name} </option> ))}
          </select>
          {loadingTagFilter && tagFilterId ? ( <span className="text-[11px] opacity-60">Carregando filtro…</span> ) : null}
        </div>

        <div className="relative mx-4">
          <Search className="absolute left-3 top-2.5 h-4 w-4 opacity-60" />
          <Input placeholder="Buscar lead..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>

        <div className="flex items-center gap-2 px-4">
          <Button type="button" variant={onlyUnread ? "default" : "outline"} size="sm" className="h-9" onClick={() => setOnlyUnread((v) => !v)} >
            <Eye className="mr-2 h-4 w-4" />
            {onlyUnread ? "Não lidas (ativo)" : "Não lidas"}
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            {isAdmin && (
              !leadSelectMode ? (
                <Button type="button" variant="outline" size="sm" className="h-9" title="Selecionar múltiplos leads" onClick={() => { setLeadSelectMode(true); setSelectedLeadJids(new Set()); }} > Selecionar </Button>
              ) : (
                <>
                  <Button type="button" variant="destructive" size="sm" className="h-9" disabled={selectedLeadJids.size === 0} title="Apagar histórico selecionado" onClick={bulkDeleteSelectedJids} > Apagar ({selectedLeadJids.size}) </Button>
                  <Button type="button" variant="outline" size="sm" className="h-9" title="Cancelar seleção" onClick={clearSelection} > Cancelar </Button>
                </>
              )
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant={leadSortOrder === "desc" ? "default" : "outline"} size="sm" className="h-9 w-9 px-0" title="Mais recentes primeiro" onClick={() => setLeadSortOrder("desc")} > <ArrowDown className="h-4 w-4" /> </Button>
            <Button type="button" variant={leadSortOrder === "asc" ? "default" : "outline"} size="sm" className="h-9 w-9 px-0" title="Mais antigas primeiro" onClick={() => setLeadSortOrder("asc")} > <ArrowUp className="h-4 w-4" /> </Button>
          </div>

          {onlyUnread && !unreadLoaded ? ( <span className="text-[11px] opacity-70">Carregando…</span> ) : null}
          {onlyUnread ? ( <Button type="button" variant="ghost" size="sm" className="h-9 px-2" onClick={() => setOnlyUnread(false)} aria-label="Limpar filtro de não lidas" title="Limpar filtro" > <X className="h-4 w-4" /> </Button> ) : null}
        </div>

          {!isAdmin && hiddenJids.size > 0 && (
            <div className="flex items-center justify-between text-xs opacity-80 px-4">
              <span>{hiddenJids.size} conversa(s) oculta(s)</span>
              <button className="underline hover:opacity-100" onClick={() => setShowHiddenDialog(true)} > Ver </button>
            </div>
          )}

        {isManager && (
          <div className="flex gap-2 mt-2 px-4">
            <Select value={urlUserFilter || adminUserFilter} onValueChange={(v) => { setAdminUserFilter(v); }} >
              <SelectTrigger className="h-9">
                <User className="mr-2 h-4 w-4 opacity-70" />
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="unassigned">Não atribuídos</SelectItem>
                {teamUsers.map((u) => ( <SelectItem key={u.id} value={u.id}> {u.nome} </SelectItem> ))}
              </SelectContent>
            </Select>

            <Select value={adminFunnelFilter} onValueChange={setAdminFunnelFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Funil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos funis</SelectItem>
                {funnels.map((f) => ( <SelectItem key={f.id} value={f.id}> {f.name} </SelectItem> ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* NOVO: CONTADOR DE MENSAGENS NÃO LIDAS (Baseado no filtro atual) */}
        <div className="px-4 mt-2 mb-1 flex items-center justify-end">
          {unreadStats.msgCount > 0 ? (
            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-semibold animate-in fade-in transition-all">
              {unreadStats.convCount} conversa(s) aguardando ({unreadStats.msgCount} não lidas)
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground opacity-70 px-2 py-0.5">
              Tudo lido por aqui 🎉
            </span>
          )}
        </div>

        <style>{`.custom-scrollbar::-webkit-scrollbar { width: 6px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(0, 0, 0, 0.1); border-radius: 10px; } .dark .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(255, 255, 255, 0.1); } `}</style>

        {/* Lista de Leads Refinada */}
        <div ref={leadListRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) { setLeadListLimit((prev) => prev + 60); }
          }}
        >
{orderedLeads.slice(0, leadListLimit).map((msg) => {
            const jid = msg.remote_jid;
            const lastMsg = lastMessageByLead[jid];

            const unreadAgg = unreadByJid.get(normalizeJid(jid));
            const unreadCount = unreadAgg?.unread_count || 0;
            const isUnread = unreadCount > 0;

            const instanceId = unreadAgg?.instance_id || lastMsg?.instance_id || msg.instance_id || null;
            const key = buildConversationKey(jid, instanceId);
            const shouldPulse = (pulseMap.get(key) || 0) > Date.now() && currentLead !== jid;

            return (
              <div
                key={msg.remote_jid}
                ref={(el) => { leadRowRefMap.current.set(msg.remote_jid, el); }}
                onClick={async () => {
                  if (leadSelectMode) { toggleSelectJid(msg.remote_jid); return; }

                  const jid = msg.remote_jid;
                  setIsSwitchingChat(true);
                  setLeadMeta(null);
                  setShowSummary(false);
                  setCurrentLead(jid);

                  if (search && msg.id) {
                    setTargetMsgId(msg.id);
                  } else {
                    setTargetMsgId(null);
                  }

                  await ensureConversationLoaded(jid);
                  await loadLeadMeta(jid);
                  setJidInUrl(jid);
                  if (isMobile) setShowChat(true);
                  setIsSwitchingChat(false);
                }}
                onContextMenu={(e) => openContextMenu(e, msg.remote_jid)}
                className={`
                  relative flex items-center gap-3 p-3 cursor-pointer transition-all border-b border-border/40
                  ${ currentLead === msg.remote_jid ? "bg-muted border-l-[3px] border-l-primary" : isUnread ? "bg-blue-50 dark:bg-blue-900/20 border-l-[3px] border-l-transparent shadow-sm" : "hover:bg-muted/50 border-l-[3px] border-l-transparent" }
                  ${shouldPulse ? "animate-[pulse-soft_2s_infinite]" : ""}
                `}
              >
                {leadSelectMode ? (
                <div className="shrink-0 pt-1">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={selectedLeadJids.has(msg.remote_jid)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelectJid(msg.remote_jid)} title="Selecionar lead" />
                </div>
              ) : null}

                {/* 1. AVATAR (Fixo na esquerda) */}
                <div className="relative shrink-0">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className={isUnread ? "bg-primary/10 text-primary font-bold" : ""}>
                      {msg.remote_jid.slice(-2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0.5 -right-0.5 bg-green-500 rounded-full p-[1.5px] border-2 border-background flex items-center justify-center">
                    <WhatsAppLogo className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>

                {/* 2. CONTEÚDO */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  
                  {/* LINHA DE CIMA: Nome + Hora */}
                  <div className="flex justify-between items-center gap-2">
                    <span className={`truncate flex-1 min-w-0 text-[15px] ${ isUnread ? "font-extrabold text-foreground" : "font-semibold text-foreground/80" }`} >
                      {(() => {
  const lead = leadCache[msg.remote_jid] || (leadMeta?.remote_jid === msg.remote_jid ? leadMeta : null);
  
  const cleanJid = msg.remote_jid.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
  // Forçamos o uso do JID real do WhatsApp, ignorando o number_lead do banco que tem o ID do CRM
  const number = cleanJid; 
  const leadName = (lead as any)?.lead_name || "";
  const leadCode = (lead as any)?.lead_code || "";
  
  const mainName = leadName || leadCode || number;
  const subInfo = leadName ? (leadCode || number) : (number !== mainName ? number : "");

  return (
    <>
      {mainName}
      {subInfo && subInfo !== mainName ? ( 
        <span className="ml-2 text-[10px] text-muted-foreground font-normal"> 
          {subInfo} 
        </span> 
      ) : null}
    </>
  );
})()}
                    </span>
                    
                    {/* Renderiza para admin e usuário comum o nome atribuído */}
                    {(() => {
                      const meta = leadCache[msg.remote_jid];
                      const uids: string[] = meta?.assigned_user_ids && Array.isArray(meta.assigned_user_ids) ? meta.assigned_user_ids : meta?.assigned_user_id ? [String(meta.assigned_user_id)] : [];

                      if (!uids.length) {
                        if (isAdmin) {
                          return (
                            <button type="button" title="Clique para gerenciar usuários deste lead" className="text-[10px] text-muted-foreground mt-0.5 hover:text-primary hover:underline text-left cursor-pointer transition-colors w-fit" onClick={(e) => { e.stopPropagation(); openAddUserDialogByJid(msg.remote_jid); }}>
                              📥 Não atribuído
                            </button>
                          );
                        }
                        return <div className="text-[10px] text-muted-foreground mt-0.5 w-fit">📥 Não atribuído</div>;
                      }

                      const names = uids.map((id) => teamUsers.find((t) => t.id === id)?.nome).filter(Boolean) as string[];

                      if (!names.length) {
                        if (isAdmin) {
                          return <button type="button" className="text-[10px] text-muted-foreground mt-0.5 hover:text-primary hover:underline text-left cursor-pointer transition-colors w-fit" onClick={(e) => { e.stopPropagation(); openAddUserDialogByJid(msg.remote_jid); }}>👤 Atribuído</button>;
                        }
                        return <div className="text-[10px] text-muted-foreground mt-0.5 w-fit">👤 Atribuído</div>;
                      }

                      const shown = names.slice(0, 2).join(", ");
                      const extra = names.length > 2 ? ` +${names.length - 2}` : "";
                      const label = `👤 ${shown}${extra}`;

                      if (isAdmin) {
                        return (
                          <button type="button" title="Clique para gerenciar usuários deste lead" className="text-[10px] text-muted-foreground mt-0.5 hover:text-primary hover:underline text-left cursor-pointer transition-colors w-fit" onClick={(e) => { e.stopPropagation(); openAddUserDialogByJid(msg.remote_jid); }}>
                            {label}
                          </button>
                        );
                      }

                      return (
                        <div className="text-[10px] text-muted-foreground mt-0.5 w-fit" title={names.join(", ")}>
                          {label}
                        </div>
                      );
                    })()}

                    <span className={`text-[11px] whitespace-nowrap shrink-0 ${ isUnread ? "text-primary font-bold" : "text-muted-foreground" }`} >
                      {formatListDate(msg.created_at)}
                    </span>
                  </div>

                  {/* LINHA DE BAIXO: Mensagem + Badge Contador */}
                  <div className="flex justify-between items-center gap-2 w-full min-w-0 mt-0.5">
                    <p className={`truncate text-xs flex-1 min-w-0 ${isUnread ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                        {msg.from_me && ( <span className="inline-flex mr-1 align-middle"> {renderAck(msg)} </span> )}
                        {msg.message ? msg.message : msg.message_type === "audio" ? "🎙️ Áudio" : msg.message_type === "image" ? "📷 Imagem" : msg.message_type === "video" ? "🎥 Vídeo" : msg.message_type === "document" ? "📄 Documento" : "Mensagem"}
                    </p>

                    {unreadCount > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center animate-in zoom-in shadow-sm">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
)}


  );
}
