import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

const COUNTDOWN_SECONDS = 60;

export function InactivityWarning() {
  const [show, setShow] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const { logout, updateActivity } = useAuth();

  useEffect(() => {
    const handleWarning = () => {
      setShow(true);
      setCountdown(COUNTDOWN_SECONDS);
    };

    window.addEventListener('inactivity-warning', handleWarning);
    return () => window.removeEventListener('inactivity-warning', handleWarning);
  }, []);

  useEffect(() => {
    if (!show) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          logout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [show, logout]);

  const handleContinue = () => {
    setShow(false);
    updateActivity();
  };

  return (
    <AlertDialog open={show} onOpenChange={setShow}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-500" />
            <AlertDialogTitle>Sessão Inativa</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-base">
            Você será desconectado automaticamente em <span className="font-bold text-destructive">{countdown}</span> segundos por inatividade.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={handleContinue} className="w-full">
            Continuar conectado
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
