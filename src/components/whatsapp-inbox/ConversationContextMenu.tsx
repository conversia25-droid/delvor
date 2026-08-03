import { CheckCheck, Clock, Trash2, User } from 'lucide-react';

export function ConversationContextMenu(props: any) {
  const { contextMenu, isAdmin, markConversationAsRead, markConversationAsUnread, deleteConversation, hideConversationForUser, openAddUserDialogByJid, setContextMenu } = props;
  if (!contextMenu.open || !contextMenu.jid) return null;

  const close = () => setContextMenu({ open: false, x: 0, y: 0, jid: null });

  return (
    <>
      {/* Backdrop invisível para fechar no mobile */}
      <div
        className="fixed inset-0 z-[49]"
        onClick={close}
        onTouchEnd={close}
      />

      <div
        className="fixed z-50 w-52 rounded-md border bg-background shadow-lg overflow-hidden"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isAdmin && (
          <>
            <button
              className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-muted active:bg-muted transition-colors"
              onClick={() => { markConversationAsRead(contextMenu.jid!); close(); }}
            >
              <CheckCheck className="h-4 w-4 text-blue-500" />
              Marcar como lida
            </button>

            <button
              className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-muted active:bg-muted transition-colors border-t"
              onClick={() => { markConversationAsUnread(contextMenu.jid!); close(); }}
            >
              <Clock className="h-4 w-4 text-orange-500" />
              Marcar como não lida
            </button>
          </>
        )}

        {isAdmin ? (
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-destructive/10 active:bg-destructive/10 text-destructive transition-colors border-t"
            onClick={() => { deleteConversation(contextMenu.jid!); }}
          >
            <Trash2 className="h-4 w-4" />
            Apagar conversa
          </button>
        ) : (
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-muted active:bg-muted transition-colors border-t"
            onClick={() => { hideConversationForUser(contextMenu.jid!); close(); }}
          >
            <Trash2 className="h-4 w-4" />
            Ocultar conversa
          </button>
        )}

        {isAdmin && (
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-muted active:bg-muted transition-colors border-t"
            onClick={() => { openAddUserDialogByJid(contextMenu.jid as string); close(); }}
          >
            <User className="h-4 w-4" /> Acrescentar usuário
          </button>
        )}
      </div>
    </>
  );
}
