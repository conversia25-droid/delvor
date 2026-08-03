export function getMessageDedupKey(msg: any) {
  return msg.message_id || msg.id || msg.client_id || msg.timestamp;
}

export function mergePreferNonNull(oldMsg: any, newMsg: any) {
  const merged = { ...oldMsg };

  Object.keys(newMsg).forEach((key) => {
    if (
      newMsg[key] !== null &&
      newMsg[key] !== undefined &&
      newMsg[key] !== ""
    ) {
      merged[key] = newMsg[key];
    }
  });

  return merged;
}

export function dedupMessages(list: any[]) {
  const map = new Map();

  list.forEach((msg) => {
    const key = getMessageDedupKey(msg);

    if (!map.has(key)) {
      map.set(key, msg);
    } else {
      const merged = mergePreferNonNull(map.get(key), msg);
      map.set(key, merged);
    }
  });

  return Array.from(map.values());
}
