export async function sendTextWebhook(payload: any) {
  try {
    await fetch("/webhook/send", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error("Erro ao enviar mensagem", e);
  }
}

export async function sendReactionWebhook(payload: any) {
  try {
    await fetch("/webhook/reaction", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error("Erro ao enviar reação", e);
  }
}
