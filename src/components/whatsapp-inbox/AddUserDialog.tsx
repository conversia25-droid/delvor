import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User, X } from 'lucide-react';

export function AddUserDialog(props: any) {
  const { addUserLead, setAddUserLead, setAddUserSelectedId, setAddUserCurrentIds, addUserCurrentIds, teamUsers, isAdmin, removeUserFromLead, addUserSelectedId, setAddUserSelectedId: setSelected, addUserToLead } = props;
  if (!addUserLead) return null;

  return (
    <Dialog open onOpenChange={() => { setAddUserLead(null); setAddUserSelectedId('unassigned'); setAddUserCurrentIds([]); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Acrescentar usuário</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm font-medium">Vinculados</div>
          {addUserCurrentIds.length ? (
            <div className="flex flex-wrap gap-2">
              {addUserCurrentIds.map((uid: any) => {
                const u = teamUsers.find((t: any) => t.id === uid);
                return (
                  <span key={uid} className="inline-flex items-center gap-2 rounded border px-2 py-1 text-xs" title={u?.email || ''}>
                    <User className="h-3 w-3 opacity-60" />
                    {u?.nome || 'Usuário'}
                    {isAdmin && (
                      <button type="button" className="ml-1 rounded p-0.5 hover:bg-muted" title="Remover" onClick={() => removeUserFromLead(uid)}>
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Nenhum usuário vinculado.</div>
          )}
        </div>

        <div className="pt-2">
          <Select value={addUserSelectedId} onValueChange={(userId) => { setSelected(userId); if (userId && userId !== 'unassigned') { void addUserToLead(userId); setSelected('unassigned'); } }}>
            <SelectTrigger>
              <SelectValue placeholder="Escolher usuário para acrescentar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Selecionar…</SelectItem>
              {teamUsers.map((u: any) => (
                <SelectItem key={u.id} value={u.id} disabled={addUserCurrentIds.includes(u.id)}>
                  {u.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DialogContent>
    </Dialog>
  );
}
