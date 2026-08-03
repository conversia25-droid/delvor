import React, { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Forward, Send, Smile, X } from "lucide-react";
import InfinityBotSheet from "@/components/InfinityBotSheet";
import DocumentGeneratorModal, { type DocumentContract, type DocumentLeadContext } from "@/components/DocumentGeneratorModal";
import QuickMessagesPopover from "@/components/whatsapp-inbox/QuickMessagesPopover";

export default function InboxConversationPane({ ctx }: { ctx: any }) {
  const {
    isMobile, showChat, isDragging, currentLead, handleDragOver, handleDragLeave, handleDrop,
    isSwitchingChat, isAdmin, duplicateLeadSuggestion, handleMergeLeads, leadMeta, isMerging,
    setShowChat, setCurrentLead, setLeadMeta, setStages, clearJidInUrl, setJidFromUrlState,
    editingLeadCode, leadCodeDraft, setLeadCodeDraft, saveLeadCode, funnels, stages, activeLeadTags,
    leadFonteInfo, selectedInstanceId, instancias, handleChangeInstance, updateLeadFunnel,
    updateLeadStage, showSummary, setShowSummary, summaryText, loadSummary, loadingSummary,
    openInfinityBot, setOpenInfinityBot, conversationRef, canLoadMoreMsgs, isLoadingOlderMsgs,
    filteredCurrentMessages, setVisibleMsgCount, CHAT_PAGE_SIZE, renderedMessages,
    renderMessageContent, targetMsgId, setForwardingMessage, sendReaction, fileInputRef,
    setPendingFiles, selectedFiles, removePendingFile, isUploading, sendWithEnter,
    setSendWithEnter, newMessage, setNewMessage, handleSend, handleComposerKeyDown,
    forwardingMessage, isForwarding, forwardSelectedJids, setForwardSelectedJids, orderedLeads,
    currentMessages, setIsForwarding, companyId, mySenderName, user, __sendTextWebhook,
    renderAck, formatMessageWithLinks, currentLeadMessagesBottomRef, setSelectedInstanceId,
    isUploadingAudio, handleAudioRecorded, RecordingWaveBars, msgSearch, setMsgSearch,
    messageDateFrom, setMessageDateFrom, messageDateTo, setMessageDateTo, resolveQuotedById,
    RenderQuotedMessage, MessageReactions, openImageViewer, setTargetMsgId, hiddenJids,
    currentAudioBars, isRecording, startRecording, stopRecording, cancelRecording,
    handleFileChange, LeadTagsBox, WhatsAppLogo,
  } = ctx;

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docContract, setDocContract] = useState<DocumentContract | null>(null);
  const [docLeadCtx, setDocLeadCtx] = useState<DocumentLeadContext>({});
  const [showLeadInfo, setShowLeadInfo] = useState(false);

  const handleOpenDocumentModal = (contract: DocumentContract, leadCtx: DocumentLeadContext) => {
    setDocContract(contract);
    setDocLeadCtx(leadCtx);
    setDocModalOpen(true);
  };

  // Helpers pra formatar info do lead no dialog
  const cleanPhone = (jid: string | null | undefined) =>
    String(jid || "").replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "—";
    }
  };

  return (
    <>
{(!isMobile || showChat) && (
        <div 
          className={`flex-1 min-w-0 w-full flex flex-col border rounded-lg relative transition-all ${isDragging ? "ring-2 ring-primary ring-inset bg-primary/5" : ""}`}
          onDragOver={currentLead ? handleDragOver : undefined}
          onDragLeave={currentLead ? handleDragLeave : undefined}
          onDrop={currentLead ? handleDrop : undefined}
        >
          {/* SOBREPOSIÇÃO VISUAL DO DRAG AND DROP */}
          {isDragging && currentLead && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-primary">
                <span className="text-5xl drop-shadow-md">📥</span>
                <p className="font-semibold text-lg drop-shadow-md">Solte seus arquivos aqui!</p>
                <p className="text-sm opacity-80">(Imagens, Vídeos, Áudios ou Documentos)</p>
              </div>
            </div>
          )}

          {isSwitchingChat ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 opacity-60">
                <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-sm">Carregando conversa…</span>
              </div>
            </div>
          ) : currentLead ? (
            <>
              {/* === BANNER DE SUGESTÃO DE MESCLAGEM (SÓ PARA ADMINS) === */}
              {isAdmin && duplicateLeadSuggestion && (
                <div className="bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in slide-in-from-top-2">
                  <div className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <span className="text-xl">⚠️</span>
                    <span>
                      Encontramos um lead duplicado <b>({duplicateLeadSuggestion.lead_name || duplicateLeadSuggestion.number_lead || duplicateLeadSuggestion.remote_jid})</b> devido à variação do 9º dígito.
                    </span>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="shrink-0 border-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100"
                    onClick={() => handleMergeLeads(leadMeta, duplicateLeadSuggestion)}
                    disabled={isMerging}
                  >
                    {isMerging ? "Mesclando..." : "Mesclar Leads"}
                  </Button>
                </div>
              )}

              {/* =========================================================
                 TOP META BAR (CABEÇALHO DO CHAT) - RESPONSIVO
                 ========================================================= */}
              <div className="p-3 sm:p-4 border-b flex flex-col gap-3 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-start sm:items-center gap-2 sm:gap-3">
                  
                  {/* ← VOLTAR (mobile) */}
                  {isMobile && (
                    <Button variant="ghost" size="sm" className="px-2 -ml-2 mt-1 sm:mt-0" onClick={() => { setShowChat(false); setCurrentLead(null); setLeadMeta(null); setStages([]); clearJidInUrl(); setJidFromUrlState(null); }} >
                      ←
                    </Button>
                  )}

                  {/* AVATAR — clica pra ver info do lead */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowLeadInfo(true); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowLeadInfo(true); } }}
                    title="Ver informações do lead"
                    aria-label="Ver informações do lead"
                    className="group relative shrink-0 mt-0.5 sm:mt-0 rounded-full cursor-pointer transition hover:ring-2 hover:ring-primary/60 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary">{currentLead.slice(-2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] leading-4 text-center text-primary-foreground opacity-0 group-hover:opacity-100 transition shadow">
                      ℹ
                    </span>
                  </div>

                  {/* NOME + CÓDIGO + FUNIL (Responsivo) */}
                  <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                    
                    {/* NOME DO LEAD (Editável) */}
                    {editingLeadCode ? (
                      <Input value={leadCodeDraft} onChange={(e) => setLeadCodeDraft(e.target.value)} autoFocus className="h-8 max-w-[240px] text-sm sm:text-base" onBlur={saveLeadCode} onKeyDown={(e) => { if (e.key === "Enter") saveLeadCode(); }} />
                    ) : (
                      <h3 className="font-semibold text-sm sm:text-base truncate cursor-pointer hover:underline flex items-center gap-2 group" onClick={() => { setLeadCodeDraft(leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.remote_jid || ""); setEditingLeadCode(true); }} >
                        <span className="truncate">{leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.remote_jid || currentLead}</span>
                        <span className="text-[10px] opacity-0 group-hover:opacity-40 transition-opacity shrink-0">✎</span>
                      </h3>
                    )}

                   {/* CÓDIGO E NÚMERO DO LEAD (EMPILHADOS) */}
                    <div className="flex flex-col gap-0.5 text-[10px] sm:text-[11px] text-muted-foreground truncate">
                      {leadMeta?.lead_code && (
                        <span title="Código do Lead">Cod: {leadMeta.lead_code}</span>
                      )}
                      
                      {/* Número de Telefone Limpo embaixo */}
                      <span title="Número do WhatsApp" className="font-medium">
                        {(leadMeta?.remote_jid || currentLead)?.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "")}
                      </span>
                    </div>

                    {/* LINHA DO FUNIL E ETAPA (Responsivo: empilha no mobile, lado a lado no desktop) */}
                    {leadMeta?.current_funnel_id && (
                      <div className="flex flex-col sm:flex-row sm:items-center mt-1 sm:mt-0.5 text-[11px] sm:text-xs leading-tight sm:leading-normal">
                        <div className="flex items-center min-w-0">
                          <span className="text-muted-foreground mr-1 shrink-0">Funil:</span>
                          <span className="font-medium text-foreground truncate">
                            {funnels.find((f) => f.id === leadMeta.current_funnel_id)?.name || "—"}
                          </span>
                        </div>
                        
                        {leadMeta?.current_stage_id && (
                          <div className="flex items-center min-w-0 mt-0.5 sm:mt-0">
                            {/* O pontinho separador só aparece no Desktop (sm) */}
                            <span className="text-muted-foreground/40 hidden sm:inline mx-2 shrink-0">•</span>
                            <span className="text-muted-foreground mr-1 shrink-0">Etapa:</span>
                            <span className="font-semibold text-primary truncate">
                              {stages.find((s) => s.id === leadMeta.current_stage_id)?.name || "Carregando..."}
                            </span>
                          </div>
                        )}
                        
                      </div>
                    )}
                    {/* 🟢 ADICIONE ESTE BLOCO LOGO AQUI: */}
{activeLeadTags.length > 0 && (
  <div className="flex flex-wrap items-center mt-1 gap-1">
    <span className="text-muted-foreground text-[10px] sm:text-[11px] mr-0.5">Tags:</span>
    {activeLeadTags.map(tag => (
      <span 
        key={tag.id} 
        className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium text-white shadow-sm"
        style={{ backgroundColor: tag.color || '#64748b' }}
      >
        {tag.name}
      </span>
    ))}
  </div>
)}
                  </div>

                  {/* INFO SUTIL (FONTE + INSTÂNCIA/ONLINE) - ESCONDIDO NO MOBILE */}
                 <div className="flex flex-col items-end mr-2 min-w-[160px] hidden md:flex gap-1">
                    <div className="text-[11px] opacity-70 truncate max-w-[260px]">
                      Fonte: <span className="opacity-90">{leadFonteInfo.display}</span>
                    </div>
          
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] opacity-70 truncate max-w-[220px]">
                        {(() => {
                          const leadSendKey = (leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || selectedInstanceId || "";
                          return leadSendKey ? ( <> Instância: <span className="opacity-90">{leadSendKey}</span> </> ) : ( <>Instância: —</> )
                        })()}
                      </div>
          
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          (() => {
                              const leadSendKey = (leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || selectedInstanceId || "";
                              const isInstanceOnline = !!(leadSendKey && instancias?.some((i: any) => i.instance_key === leadSendKey));
                              return isInstanceOnline ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "bg-muted border-border text-muted-foreground"
                          })()
                        }`}
                      >
                         {(() => {
                              const leadSendKey = (leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || selectedInstanceId || "";
                              const isInstanceOnline = !!(leadSendKey && instancias?.some((i: any) => i.instance_key === leadSendKey));
                              return isInstanceOnline ? "Online" : "Offline"
                          })()}
                      </span>
          
                      {(() => {
                        const rawKey = (leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || selectedInstanceId || "";
                        const isValid = instancias.some((i: any) => String(i.instance_key) === String(rawKey));
                        const leadSendKey = isValid && rawKey ? String(rawKey) : undefined;

                        return (instancias.length > 0 && isAdmin && (
                          <Popover modal={true}>
                            <PopoverTrigger asChild>
                              <button type="button" className="text-[10px] px-2 py-0.5 rounded-full border hover:bg-muted transition" title="Trocar instância de envio" > Trocar </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64" onClick={(e) => e.stopPropagation()}>
                              <div className="text-sm font-medium mb-2">Trocar instância</div>
                              <Select value={leadSendKey} onValueChange={(val) => handleChangeInstance(val)} >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {instancias.map((inst: any) => {
                                    const keyStr = String(inst.instance_key || inst.id || "");
                                    if (!keyStr) return null;
                                    return ( 
                                      <SelectItem key={keyStr} value={keyStr}> 
                                        {inst.instance_name || keyStr} 
                                      </SelectItem> 
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              <div className="text-[11px] opacity-70 mt-2"> Se estiver offline, selecione uma instância conectada. </div>
                            </PopoverContent>
                          </Popover>
                        ))
                      })()}
                    </div>
                  </div>

                  {/* AÇÕES (Tags, Funil, etc) */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 shrink-0 mt-1 sm:mt-0">
                    <div className="flex items-center gap-1">
                      {/* 🏷 TAGS */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button title="Tags" className="p-2 rounded-md hover:bg-muted transition flex items-center gap-1" >
                            🏷
                            {!isMobile && <span className="text-xs">Tags</span>}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72" onClick={(e) => e.stopPropagation()} >
                          {leadMeta?.id ? ( <LeadTagsBox leadId={leadMeta.id} /> ) : ( <div className="text-xs text-center p-2 opacity-50"> Carregando dados do lead... </div> )}
                        </PopoverContent>
                      </Popover>

                      {/* 🔄 FUNIL */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button title="Funil" className="p-2 rounded-md hover:bg-muted transition flex items-center gap-1" >
                            🔄
                            {!isMobile && <span className="text-xs">Funil</span>}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 space-y-3 p-4">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Selecionar Funil</label>
                            <Select value={leadMeta?.current_funnel_id ?? ""} onValueChange={(v) => updateLeadFunnel(v || null)} >
                              <SelectTrigger>
                                <SelectValue placeholder="Escolher funil" />
                              </SelectTrigger>
                              <SelectContent>
                                {funnels.filter((f) => f.active).map((f) => ( <SelectItem key={f.id} value={f.id}> {f.name} </SelectItem> ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {stages.length > 0 && (
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">Selecionar Etapa</label>
                              <Select value={leadMeta?.current_stage_id ?? ""} onValueChange={(v) => updateLeadStage(v || null)} >
                                <SelectTrigger>
                                  <SelectValue placeholder="Escolher etapa" />
                                </SelectTrigger>
                                <SelectContent>
                                  {stages.map((s) => ( <SelectItem key={s.id} value={s.id}> {s.name} </SelectItem> ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>

                      {/* 🏆 BOTÃO DE CONTRATO FECHADO */}
                      <button 
                        title="Comemorar Contrato Fechado na TV!" 
                        onClick={handleCloseDeal}
                        disabled={isClosingDeal}
                        className="p-2 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white transition flex items-center gap-1 shadow-sm disabled:opacity-50"
                      >
                        {isClosingDeal ? "⏳" : "🏆"}
                        {!isMobile && <span className="text-xs font-bold">Vendeu!</span>}
                      </button>
                    </div>

                    {/* 📌 FONTE DO LEAD (perto do resumo) - MOBILE */}
                    <div className="flex md:hidden items-center mt-1" title={leadFonteInfo.tooltip} >
                      <span className="text-[10px] px-2 py-0.5 rounded-full border bg-muted/50 text-muted-foreground max-w-[100px] truncate">
                        📌 {leadFonteInfo.display}
                      </span>
                    </div>

                  </div>
                </div>
              </div>


{/* LISTA DE MENSAGENS */}
              <ScrollArea className="flex-1 min-w-0 p-4" viewportRef={scrollAreaRef}>
                <div className="space-y-4 overflow-x-hidden min-w-0 flex flex-col">
                  {canLoadMoreMsgs && (
                    <div className="flex justify-center pb-2">
                      <Button variant="ghost" size="sm" disabled={isLoadingOlderMsgs || isLoadingOlderDb} onClick={async () => {
                          const el = scrollAreaRef.current;
                          if (!el || !currentLead) return;

                          const total = filteredCurrentMessages.length;

                          if (visibleMsgCount < total) {
                            scrollAdjustRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
                            setIsLoadingOlderMsgs(true);
                            setVisibleMsgCount((c) => Math.min(c + CHAT_PAGE_SIZE, total));
                            return;
                          }

                          scrollAdjustRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
                          await loadOlderMessagesFromDb(currentLead);
                        }}
                      >
                        {(isLoadingOlderMsgs || isLoadingOlderDb) ? "Carregando..." : (canLoadMoreLocal ? "Carregar mensagens anteriores" : "Buscar mais antigas no banco")}
                      </Button>
                    </div>
                  )}
                  {renderedMessages}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* PREVIEW GALERIA (MULTIPLE FILES) */}
              {pendingMedia.length > 0 && (
                <div className="p-3 border-t bg-muted">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Pré-visualização ({pendingMedia.length})</p>
                    <Button variant="ghost" size="sm" onClick={() => setPendingMedia([])} className="h-6 px-2 text-xs"> Limpar tudo </Button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                    {pendingMedia.map((media, idx) => (
  <div key={idx} className={`relative shrink-0 border rounded-md bg-background overflow-hidden group flex items-center justify-center ${media.type === 'audio' ? 'w-64 h-24 px-4' : 'w-24 h-24'}`}>
    <button type="button" className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={() => setPendingMedia(prev => prev.filter((_, i) => i !== idx))}>
      <X className="w-3 h-3" />
    </button>
    
    {media.type === "image" && <img src={media.url} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setZoomImageUrl(media.url)} />}
    {media.type === "video" && <video src={media.url} className="w-full h-full object-cover" controls />}
    {media.type === "audio" && (
      <div className="flex flex-col items-center justify-center w-full">
        <audio src={media.url} controls className="w-full h-10 outline-none" />
      </div>
    )}
    {media.type === "document" && <div className="flex flex-col items-center"><span className="text-2xl">📄</span><span className="text-[9px] truncate w-20 text-center mt-1 px-1">{media.file.name}</span></div>}
  </div>
))}
                  </div>
                  <div className="flex justify-end gap-2 mt-3">
                    <Button variant="outline" onClick={() => setPendingMedia([])}>Cancelar</Button>
                    <Button onClick={sendPendingMedia}>Enviar {pendingMedia.length > 1 ? "Mídias" : ""}</Button>
                  </div>
                </div>
              )}

              {/* INPUT */}
              {replyingTo && (
                <div className="flex items-center justify-between bg-muted/50 px-4 py-2 border-l-4 border-primary mb-1 mx-2 rounded-r animate-in slide-in-from-bottom-2 overflow-hidden max-w-full">
                  <div className="flex flex-col overflow-hidden min-w-0 flex-1 pr-2">
                    <span className="text-xs font-bold text-primary mb-0.5 truncate"> {replyingTo.from_me ? "Atendente" : leadMeta?.lead_name || leadMeta?.lead_code || currentLead} </span>
                    <span className="text-xs truncate text-muted-foreground max-w-full"> {getReplyPreview(replyingTo)} </span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingTo(null)} >
                    <X className="h-4 w-4 opacity-70" />
                  </Button>
                </div>
              )}
              <div className="border-t bg-background px-2 py-2 sm:px-4">
                <div className="flex items-end gap-2">
                  {/* 🎙️ Gravação */}
                  {isRecording ? (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-red-500 bg-red-500/10">
                      <RecordingWaveBars levels={audioLevels} />
                      <span className="text-sm font-semibold text-red-600"> {formatTime(recordingTime)} </span>
                      <Button variant="destructive" size="sm" onClick={stopRecording} > ⏹️ </Button>
                      <Button variant="outline" size="sm" onClick={cancelRecording} title="Cancelar Gravação"> ❌ </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="icon" className="shrink-0 rounded-full h-10 w-10" onClick={startRecording} title="Gravar áudio" > 🎙️ </Button>
                  )}

                  {/* 📎 + Campo de texto */}
                  <div className="flex-1 flex items-end gap-2 rounded-2xl border bg-muted px-3 py-2">
                    <div className="relative">
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowMediaMenu((v) => !v)} title="Enviar mídia" > 📎 </Button>
                      {showMediaMenu && (
                        <div className="absolute bottom-full mb-2 left-0 bg-background border rounded-lg shadow-lg z-50 w-44">
                          {(Object.keys(MEDIA_CONFIG) as MediaType[]).map(
                            (type) => (
                              <button key={type} className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition" 
                                onClick={() => { 
                                  if (fileInputRef.current) { 
                                    fileInputRef.current.accept = type === 'video' ? 'video/mp4' : MEDIA_CONFIG[type].accept; 
                                    fileInputRef.current.click(); 
                                  } 
                                  setShowMediaMenu(false); 
                                }} 
                              >
                                {MEDIA_CONFIG[type].label}
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    {/* 😀 EMOJIS CATEGORIZADOS */}
                    <Popover open={openEmojiPicker} onOpenChange={setOpenEmojiPicker}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9" title="Emojis"> 
                          <Smile className="h-4 w-4" /> 
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="start" sideOffset={10} className="w-80 p-0 overflow-hidden flex flex-col h-80">
                        {/* Cabeçalho do seletor */}
                        <div className="bg-muted px-3 py-2 border-b text-xs font-semibold">
                          Seletor de Emojis
                        </div>
                        
                        {/* Área de rolagem com as categorias */}
                        <ScrollArea className="flex-1 p-3 custom-scrollbar">
                          <div className="space-y-4">
                            {EMOJI_CATEGORIES.map((category, idx) => (
                              <div key={idx}>
                                <h4 className="text-[11px] font-medium text-muted-foreground mb-1 ml-1 uppercase tracking-wider">
                                  {category.title}
                                </h4>
                                <div className="grid grid-cols-8 gap-1">
                                  {category.emojis.map((emoji, eIdx) => (
                                    <button 
                                      key={`${emoji}-${eIdx}`} 
                                      type="button" 
                                      className="h-8 w-8 rounded hover:bg-muted transition flex items-center justify-center text-[19px] hover:scale-110" 
                                      onClick={() => { insertEmojiAtCursor(emoji); setOpenEmojiPicker(false); }} 
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    
                    {/* ✅ CAMPO DE TEXTO */}
                    <Textarea
                      ref={inputRef} 
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={1}
                      placeholder="Digite sua mensagem"
                      className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[44px] max-h-[120px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && sendWithEnter) { e.preventDefault(); sendMessage(); }
                      }}
                    />

                    {/* ∞ INFINITY BOT (balão) */}
                    <div className="relative">
                      <Button size="icon" variant="outline" title="InfinityBot" onClick={() => { if (openInfinityBot) { startCloseInfinityBot(); } else { setBotClosing(false); setOpenInfinityBot(true); } }} className="shrink-0 rounded-full h-9 w-9 border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground transition-colors" >
                        <span className="font-bold">∞</span>
                      </Button>

                      {(openInfinityBot || botClosing) && (
                        <>
                          <div className={`fixed inset-0 z-[70] bg-black/10 backdrop-blur-sm ${ botClosing ? "animate-out fade-out-0" : "animate-in fade-in-0" }`} onMouseDown={(e) => { e.preventDefault(); startCloseInfinityBot(); }} />

                          <div className={`absolute bottom-full right-0 mb-2 z-[80] w-[min(88vw,360px)] h-[min(62dvh,480px)] rounded-2xl border bg-background/95 shadow-xl overflow-hidden origin-bottom-right transform-gpu ${ botClosing ? "animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-2" : "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2" }`} onMouseDown={(e) => e.stopPropagation()} >
                            <div className="absolute -bottom-2 right-4 h-4 w-4 rotate-45 bg-background/95 border border-t-0 border-l-0" />

                            <button type="button" className="absolute top-2 right-2 z-10 rounded-full bg-background/80 backdrop-blur border p-1.5 hover:bg-muted" onClick={() => startCloseInfinityBot()} aria-label="Fechar" >
                              <X className="h-4 w-4" />
                            </button>

                            <div className="h-full w-full">
                              <InfinityBotSheet
                                open={openInfinityBot}
                                onOpenChange={(v) => { if (!v) startCloseInfinityBot(); else setOpenInfinityBot(true); }}
                                leadId={leadMeta?.id ?? null}
                                leadDisplay={ (leadMeta as any)?.lead_name || (leadMeta as any)?.lead_code || (leadMeta as any)?.number_lead || (leadMeta as any)?.remote_jid || currentLead || "Lead" }
                                remoteJid={currentLead || ""}
                                instanceId={selectedInstanceId || (leadMeta as any)?.instance_id || (instancias?.find?.((i: any) => i.is_default)?.instance_key ?? null)}
                                botIconSrc={infinityBotIcon}
                                summaryText={leadMeta?.chat_summary || ""}
                                summaryUpdatedAt={leadMeta?.chat_summary_updated_at || null}
                                summaryHtmlUrl={(leadMeta as any)?.chat_summary_html_url || null}
                                onGenerateSummary={requestConversationSummary}
                                onGenerateSummaryHtml={generateSummaryHtml}
                                onOpenDocumentModal={handleOpenDocumentModal}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>


                    <Button size="icon" className="shrink-0 rounded-full h-9 w-9" onClick={sendMessage} disabled={!text.trim() && !forwardingMessage && pendingMedia.length === 0} >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="px-4 pb-2 text-xs opacity-70 flex gap-2 border-t pt-2 mt-2">
                <input type="checkbox" checked={sendWithEnter} onChange={(e) => setSendWithEnter(e.target.checked)} id="sendWithEnter" />
                <label htmlFor="sendWithEnter" className="cursor-pointer">Enviar com Enter</label>
              </div>

              {/* MODAL DE GALERIA INTELIGENTE */}
{zoomImageUrl && (() => {
  // 1. Filtra todas as imagens e vídeos da conversa atual
  const chatMediaItems = currentMessages
    .filter(m => {
      const type = String(m.message_type || "").toLowerCase();
      const url = m.media_url || m._local_preview_url || "";
      // Pega mídias pelo tipo ou pela extensão do arquivo
      return type === "image" || type === "video" || url.match(/\.(jpg|jpeg|png|webp|mp4|mov|webm)$/i);
    })
    .map(m => m.media_url || m._local_preview_url)
    .filter(Boolean) as string[];

  // Remove duplicatas (caso haja) e acha onde a imagem atual está na lista
  const uniqueMediaItems = Array.from(new Set(chatMediaItems));
  const currentIndex = uniqueMediaItems.indexOf(zoomImageUrl);
  const isVideo = zoomImageUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i);

  // Controle pelo teclado (Setas para o lado e Esc para sair)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" && currentIndex > 0) {
      setZoomImageUrl(uniqueMediaItems[currentIndex - 1]);
    } else if (e.key === "ArrowRight" && currentIndex < uniqueMediaItems.length - 1) {
      setZoomImageUrl(uniqueMediaItems[currentIndex + 1]);
    } else if (e.key === "Escape") {
      setZoomImageUrl(null);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm outline-none" 
      onClick={() => setZoomImageUrl(null)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      ref={(el) => el?.focus()} // Dá foco automático para o teclado funcionar na hora
    >
      {/* Botão Fechar */}
      <button className="absolute top-4 right-4 bg-black/50 text-white rounded-full p-2 hover:bg-black/80 z-50 transition" onClick={() => setZoomImageUrl(null)}> 
        <X className="h-6 w-6" /> 
      </button>

      {/* Seta para a Esquerda */}
      {currentIndex > 0 && (
        <button 
          className="absolute left-2 sm:left-8 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full h-12 w-12 flex items-center justify-center hover:bg-black/80 z-50 transition" 
          onClick={(e) => { e.stopPropagation(); setZoomImageUrl(uniqueMediaItems[currentIndex - 1]); }}
          title="Anterior"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
      )}

      {/* Mídia Central (Imagem ou Vídeo) */}
      <div className="relative max-w-full max-h-full flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={zoomImageUrl} controls autoPlay className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
        ) : (
          <img src={zoomImageUrl} className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
        )}
        
        {/* Contador de Mídias (Ex: 1 de 5) */}
        {uniqueMediaItems.length > 1 && (
          <div className="absolute -bottom-8 bg-black/50 px-3 py-1 rounded-full text-white/90 text-xs font-medium">
            {currentIndex + 1} de {uniqueMediaItems.length}
          </div>
        )}
      </div>

      {/* Seta para a Direita */}
      {currentIndex < uniqueMediaItems.length - 1 && (
        <button 
          className="absolute right-2 sm:right-8 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full h-12 w-12 flex items-center justify-center hover:bg-black/80 z-50 transition" 
          onClick={(e) => { e.stopPropagation(); setZoomImageUrl(uniqueMediaItems[currentIndex + 1]); }}
          title="Próxima"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      )}

    </div>
  );
})()}
            
      {/* MODAL DE ENCAMINHAMENTO */}
{forwardingMessage && (
  <Dialog 
    open={true} 
    onOpenChange={(isOpen) => { 
      if (!isOpen) { 
        setForwardingMessage(null); 
        setForwardSelectedJids(new Set()); 
        setForwardSearch(""); 
      } 
    }}
  >
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Encaminhar Mensagem</DialogTitle>
      </DialogHeader>

      {/* Preview do que está sendo encaminhado */}
      <div className="bg-muted p-3 rounded-lg text-sm mb-2 border border-border/50 max-h-24 overflow-hidden relative">
        <div className="font-semibold text-xs text-muted-foreground mb-1 flex items-center gap-1">
          <Forward className="w-3 h-3"/> Pré-visualização:
        </div>
        {forwardingMessage.message_type === "image" || forwardingMessage.media_url?.match(/\.(jpg|jpeg|png|webp)$/i) ? "📷 Imagem selecionada" :
         forwardingMessage.message_type === "video" || forwardingMessage.media_url?.match(/\.(mp4|mov|webm)$/i) ? "🎥 Vídeo selecionado" :
         forwardingMessage.message_type === "audio" ? "🎙️ Áudio selecionado" :
         forwardingMessage.message_type === "document" ? "📄 Documento selecionado" :
         <span className="line-clamp-2">{forwardingMessage.message}</span>}
      </div>

      <Input 
        placeholder="Buscar contato..." 
        value={forwardSearch} 
        onChange={(e) => setForwardSearch(e.target.value)} 
        className="mb-2"
      />

      {/* Lista de Contatos */}
      <ScrollArea className="h-60 border rounded-md p-2">
        {Object.entries(leadCache || {})
          .filter(([jid, meta]) => {
            // 1. Respeita as regras de permissão (ocultos e atribuição)
            if (!isAdmin && hiddenJids.has(jid)) return false;
            if (!isAdmin && myUserId) {
              const uids = Array.isArray(meta?.assigned_user_ids) ? meta.assigned_user_ids : (meta?.assigned_user_id ? [String(meta.assigned_user_id)] : []);
              if (!uids.includes(myUserId) && String(meta?.assigned_user_id) !== myUserId) return false;
            }

            // 2. Aplica APENAS a busca do próprio modal de encaminhar
            const searchStr = forwardSearch.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const name = String(meta?.lead_name || meta?.lead_code || jid).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            return name.includes(searchStr);
          })
          .sort(([jidA, metaA], [jidB, metaB]) => {
            // Opcional: Organiza por ordem alfabética para facilitar
            const nameA = String(metaA?.lead_name || metaA?.lead_code || jidA).toLowerCase();
            const nameB = String(metaB?.lead_name || metaB?.lead_code || jidB).toLowerCase();
            return nameA.localeCompare(nameB);
          })
          .map(([jid, meta]) => {
            const name = meta?.lead_name || meta?.lead_code || jid.replace(/@s\.whatsapp\.net$/i, "");
            const isSelected = forwardSelectedJids.has(jid);

            return (
              <div 
                key={jid} 
                className="flex items-center gap-3 p-2 hover:bg-muted cursor-pointer rounded-md transition"
                onClick={() => {
                  setForwardSelectedJids(prev => {
                    const next = new Set(prev);
                    if (next.has(jid)) next.delete(jid);
                    else next.add(jid);
                    return next;
                  });
                }}
              >
                <input 
                  type="checkbox" 
                  checked={isSelected} 
                  readOnly 
                  className="w-4 h-4 accent-primary pointer-events-none"
                />
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {name.slice(0,2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate">{name}</span>
              </div>
            );
        })}
      </ScrollArea>

      <div className="flex justify-between items-center mt-4">
        <span className="text-xs text-muted-foreground">
          {forwardSelectedJids.size} contato(s) selecionado(s)
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setForwardingMessage(null); setForwardSelectedJids(new Set()); }} disabled={isForwarding}>
            Cancelar
          </Button>
          <Button 
            disabled={forwardSelectedJids.size === 0 || isForwarding}
            onClick={async () => {
              if (forwardSelectedJids.size === 0 || !companyId) return;
              setIsForwarding(true);

              try {
                const fallbackInstanceIdForSend = instancias.find((i) => i.is_default)?.instance_key ?? null;
                const instanceId = getInstanceForSend() || fallbackInstanceIdForSend || "";

                // === CORREÇÃO: Resgatando os dados completos da instância ===
                const inst = instancias.find((i: any) =>
                  i.instance_key === instanceId ||
                  i.id === instanceId ||
                  String(i.phone_number) === String(instanceId)
                );

                const finalInstanceKey = inst?.instance_key || instanceId;
                const finalPhoneNumber = inst?.phone_number ? String(inst.phone_number) : "";
                const finalInstanceId  = inst?.id || "";
                // ============================================================

                // Verifica se é mídia
                const type = String(forwardingMessage.message_type || "text").toLowerCase();
                const isMedia = ["image", "video", "audio", "document"].includes(type) || !!forwardingMessage.media_url;

                // Loop para enviar para os contatos selecionados
                for (const targetJid of Array.from(forwardSelectedJids)) {
                  const localClientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                  const localCreatedAt = new Date().toISOString();

                  if (isMedia) {
                    const mediaUrl = forwardingMessage.media_url || forwardingMessage._local_preview_url;
                    if (!mediaUrl) continue;
                    
                    // Transforma a URL da mídia num arquivo para o n8n
                    const res = await fetch(mediaUrl);
                    const blob = await res.blob();
                    const ext = mediaUrl.split('.').pop()?.split('?')[0] || "bin";
                    const file = new File([blob], `encaminhado.${ext}`, { type: blob.type });

                    const fd = new FormData();
                    fd.append("file", file);
                    fd.append("type", type);
                    fd.append("media_type", type);
                    fd.append("number", targetJid);
                    fd.append("text", forwardingMessage.message || "");
                    fd.append("caption", forwardingMessage.message || "");
                    fd.append("mimetype", blob.type);
                    
                    // === CORREÇÃO AQUI (Injetando todas as chaves no FormData) ===
                    fd.append("instance_key", finalInstanceKey);
                    fd.append("instance_phone_number", finalPhoneNumber);
                    fd.append("instance_id", finalInstanceId);
                    fd.append("company_id", String(companyId));
                    fd.append("sent_by_name", mySenderName);
                    fd.append("sent_by_role", isAdmin ? "admin" : "user");
                    fd.append("sent_by_user_id", String((user as any)?.id ?? ""));
                    fd.append("local_client_id", localClientId);
                    fd.append("sent_at", localCreatedAt);
                    // ============================================================

                    const webhookUrl = (import.meta.env.VITE_INBOX_MEDIA_WEBHOOK_URL as string) || (import.meta.env.VITE_INBOX_TEXT_WEBHOOK_URL as string) || "https://infnitycrm.zapcompany.com.br/webhook/enviosmidiacrm";
                    await fetch(webhookUrl, { method: "POST", body: fd });

                  } else {
                    // Texto normal
                    // === CORREÇÃO AQUI (Injetando no JSON do texto) ===
                    const payload = {
                      number: targetJid,
                      text: forwardingMessage.message,
                      local_client_id: localClientId,
                      sent_at: localCreatedAt,
                      company_id: companyId,
                      sent_by_name: mySenderName,
                      sent_by_role: isAdmin ? "admin" : "user",
                      sent_by_user_id: (user as any)?.id ?? null,
                      raw_payload: {
                        local_client_id: localClientId,
                        sent_at: localCreatedAt,
                        sent_by_name: mySenderName,
                        sent_by_role: isAdmin ? "admin" : "user",
                        sent_by_user_id: (user as any)?.id ?? null,
                      }
                    };
                    // Usando o finalInstanceKey para garantir o envio correto
                    await __sendTextWebhook(instancias as any, finalInstanceKey, payload);
                    // ============================================================
                  }
                }
                
                alert("Encaminhado com sucesso!");
                setForwardingMessage(null);
                setForwardSelectedJids(new Set());
              } catch (e) {
                console.error("Erro ao encaminhar", e);
                alert("Ocorreu um erro ao encaminhar a mensagem.");
              } finally {
                setIsForwarding(false);
              }
            }}
          >
            {isForwarding ? "Enviando..." : "Encaminhar"} <Forward className="w-4 h-4 ml-2"/>
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
)}

            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
              <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mb-4">
                <WhatsAppLogo className="h-10 w-10 text-primary/50" />
              </div>
              <p className="text-xl font-medium mb-2">Selecione uma conversa</p>
              <p className="max-w-md text-sm">Escolha um lead na barra lateral para ver o histórico e enviar novas mensagens.</p>
            </div>
          )}
        </div>
      )}

      <DocumentGeneratorModal
        open={docModalOpen}
        onOpenChange={setDocModalOpen}
        contract={docContract}
        lead={docLeadCtx}
      />

      {/* DIALOG: INFORMAÇÕES DO LEAD (abre ao clicar no avatar) */}
      <Dialog open={showLeadInfo} onOpenChange={setShowLeadInfo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Informações do lead</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div className="flex items-center gap-3 pb-3 border-b">
              <Avatar className="h-14 w-14">
                <AvatarFallback className="bg-primary/10 text-primary text-lg">
                  {String(leadMeta?.lead_name || currentLead || "??").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base truncate">
                  {leadMeta?.lead_name || leadMeta?.lead_code || cleanPhone(leadMeta?.remote_jid || currentLead) || "Sem nome"}
                </div>
                {leadMeta?.lead_code && leadMeta?.lead_code !== leadMeta?.lead_name && (
                  <div className="text-xs text-muted-foreground truncate">Cod: {leadMeta.lead_code}</div>
                )}
              </div>
            </div>

            {/* Grid de campos */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-muted-foreground">WhatsApp</div>
              <div className="col-span-2 font-medium break-all">
                {cleanPhone(leadMeta?.remote_jid || currentLead) || "—"}
              </div>

              <div className="text-muted-foreground">Email</div>
              <div className="col-span-2 break-all">
                {(leadMeta as any)?.email ? (
                  <a href={`mailto:${(leadMeta as any).email}`} className="text-primary hover:underline">
                    {(leadMeta as any).email}
                  </a>
                ) : (
                  <span className="text-muted-foreground italic">—</span>
                )}
              </div>

              <div className="text-muted-foreground">Funil</div>
              <div className="col-span-2">
                {leadMeta?.current_funnel_id
                  ? (funnels.find((f: any) => f.id === leadMeta.current_funnel_id)?.name || "—")
                  : <span className="text-muted-foreground italic">—</span>}
              </div>

              <div className="text-muted-foreground">Etapa</div>
              <div className="col-span-2">
                {leadMeta?.current_stage_id
                  ? (stages.find((s: any) => s.id === leadMeta.current_stage_id)?.name || "—")
                  : <span className="text-muted-foreground italic">—</span>}
              </div>

              <div className="text-muted-foreground">Fonte</div>
              <div className="col-span-2 break-all">
                {leadFonteInfo?.display || (leadMeta as any)?.source || <span className="text-muted-foreground italic">—</span>}
              </div>

              <div className="text-muted-foreground">Instância</div>
              <div className="col-span-2 break-all">
                {(leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || <span className="text-muted-foreground italic">—</span>}
              </div>

              {activeLeadTags?.length > 0 && (
                <>
                  <div className="text-muted-foreground">Tags</div>
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {activeLeadTags.map((tag: any) => (
                      <span
                        key={tag.id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white shadow-sm"
                        style={{ backgroundColor: tag.color || "#64748b" }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </>
              )}

              <div className="text-muted-foreground">Criado em</div>
              <div className="col-span-2">{formatDate((leadMeta as any)?.created_at)}</div>

              {(leadMeta as any)?.last_message_at && (
                <>
                  <div className="text-muted-foreground">Última msg</div>
                  <div className="col-span-2">{formatDate((leadMeta as any).last_message_at)}</div>
                </>
              )}
            </div>

            {/* Ações rápidas */}
            <div className="flex flex-wrap gap-2 pt-3 border-t">
              {(leadMeta as any)?.email && (
                <Button asChild variant="outline" size="sm">
                  <a href={`mailto:${(leadMeta as any).email}`}>Enviar email</a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const phone = cleanPhone(leadMeta?.remote_jid || currentLead);
                  if (phone) {
                    navigator.clipboard.writeText(phone);
                  }
                }}
              >
                Copiar telefone
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowLeadInfo(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
