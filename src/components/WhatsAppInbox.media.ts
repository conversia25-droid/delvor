export const MEDIA_CONFIG = {
  image: {
    label: "Imagem",
    accept: "image/jpeg,image/png,image/webp",
    extensions: ["jpg", "jpeg", "png", "webp"],
  },
  video: {
    label: "Vídeo",
    accept: "video/mp4,video/webm,video/quicktime",
    extensions: ["mp4", "webm", "mov"],
  },
  audio: {
    label: "Áudio",
    accept: "audio/mpeg,audio/ogg,audio/opus,audio/wav,audio/mp4,audio/webm",
    extensions: ["mp3", "ogg", "opus", "wav", "m4a", "webm"],
  },
  document: {
    label: "Documento",
    // Adicionamos application/msword (.doc) e o MIME do .docx
    accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["pdf", "doc", "docx"],
  },
} as const;

export type MediaType = keyof typeof MEDIA_CONFIG;