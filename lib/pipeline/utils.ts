export function extractTargetSeconds(topic: string): number | null {
  const minMatch = topic.match(/(\d+)\s*분/);
  const secMatch = topic.match(/(\d+)\s*초/);
  if (minMatch && secMatch) return parseInt(minMatch[1]) * 60 + parseInt(secMatch[1]);
  if (minMatch) return parseInt(minMatch[1]) * 60;
  if (secMatch) return parseInt(secMatch[1]);
  return null;
}

export async function uploadBufferToFal(
  apiKey: string,
  buffer: Buffer | Uint8Array,
  filename: string,
  mimeType: string
): Promise<string> {
  const initiateRes = await fetch(
    'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
    {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: mimeType, file_name: filename }),
    }
  );
  if (!initiateRes.ok) {
    const err = await initiateRes.text();
    throw new Error(`FAL initiate 실패: ${initiateRes.status} ${err}`);
  }
  const { upload_url, file_url } = (await initiateRes.json()) as { upload_url: string; file_url: string };

  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: new Uint8Array(buffer),
  });
  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`FAL PUT 업로드 실패: ${putRes.status} ${err}`);
  }

  return file_url;
}
