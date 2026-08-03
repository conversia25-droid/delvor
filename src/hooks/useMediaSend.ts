import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";



interface MediaConfig {
  maxSizeMB: number;
  allowedTypes: string[];
}

const MEDIA_CONFIG: Record<string, MediaConfig> = {
  image: {
    maxSizeMB: 10,
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  video: {
    maxSizeMB: 50,
    allowedTypes: ["video/mp4", "video/webm"],
  },
  document: {
    maxSizeMB: 20,
    allowedTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
};

export function useMediaSend(
  companyId: string | null,
  instanceId: string | null,
  currentLead: string | null
) {
  /* =====================================================
     STATES
  ===================================================== */

  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);

  /* =====================================================
     REFS
  ===================================================== */

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  /* =====================================================
     HELPERS
  ===================================================== */

  function validateFile(file: File, type: keyof typeof MEDIA_CONFIG) {
    const config = MEDIA_CONFIG[type];

    if (!config.allowedTypes.includes(file.type)) {
      throw new Error("Tipo de arquivo não permitido");
    }

    if (file.size > config.maxSizeMB * 1024 * 1024) {
      throw new Error("Arquivo excede o tamanho permitido");
    }
  }

  function resetPreview() {
    setPreviewFile(null);
    setPreviewUrl(null);
  }

  /* =====================================================
     FILE PICKER
  ===================================================== */

  function handleFileChange(
    file: File,
    type: keyof typeof MEDIA_CONFIG
  ) {
    validateFile(file, type);
    setPreviewFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  /* =====================================================
     AUDIO
  ===================================================== */

  async function startRecording() {
    if (isRecording) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      audioChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, {
        type: "audio/webm",
      });
      const file = new File([blob], "audio.webm", {
        type: "audio/webm",
      });

      setPreviewFile(file);
      setPreviewUrl(URL.createObjectURL(blob));
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);

    recordTimerRef.current = window.setInterval(() => {
      setRecordDuration((d) => d + 1);
    }, 1000);
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream
      .getTracks()
      .forEach((t) => t.stop());

    mediaRecorderRef.current = null;
    setIsRecording(false);

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  function cancelRecording() {
    stopRecording();
    resetPreview();
    setRecordDuration(0);
  }

  /* =====================================================
     SEND MEDIA
  ===================================================== */

  async function sendMedia(
    type: "image" | "video" | "document" | "audio",
    caption?: string
  ) {
    if (!companyId || !instanceId || !currentLead || !previewFile)
      return;

    const path = `${companyId}/${Date.now()}-${previewFile.name}`;

    const { error: uploadError } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, previewFile);

    if (uploadError) {
      console.error("Erro upload:", uploadError);
      return;
    }

    const { data } = supabase.storage
      .from("whatsapp-media")
      .getPublicUrl(path);

    await supabase.from("whatsapp_outbox").insert({
      company_id: companyId,
      instance_id: instanceId,
      remote_jid: currentLead,
      message_type: type,
      media_url: data.publicUrl,
      caption: caption || null,
    });

    resetPreview();
    setRecordDuration(0);
  }

  return {
    // preview
    previewFile,
    previewUrl,
    resetPreview,

    // picker
    handleFileChange,

    // audio
    isRecording,
    recordDuration,
    startRecording,
    stopRecording,
    cancelRecording,

    // send
    sendMedia,
  };
}
