import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function HiddenConversationsDialog(props: any) {
  const { isAdmin, showHiddenDialog, setShowHiddenDialog, hiddenJids, leadCache, unhideConversationForUser } = props;
  if (isAdmin || !showHiddenDialog) return null;

  return (
    <Dialog open onOpenChange={(o) => setShowHiddenDialog(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conversas ocultas</DialogTitle>
        </DialogHeader>

        {hiddenJids.size === 0 ? (
          <div className="text-sm opacity-70">Nenhuma conversa oculta.</div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-auto">
            {Array.from(hiddenJids).map((jid: any) => (
              <div key={jid} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {leadCache[jid]?.lead_name || leadCache[jid]?.lead_code || jid}
                  </div>
                  <div className="text-[11px] opacity-60 truncate">{jid}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => unhideConversationForUser(jid)}>
                  Mostrar
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => setShowHiddenDialog(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
