// Native (Capacitor iOS) integration. Everything here is a no-op in a normal browser.
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Save a generated file. On iPhone: write to the app cache and open the share sheet (Files, AirDrop, Mail…). */
export async function saveFile(buf: ArrayBuffer, name: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const safe = name.replace(/[\\/:*?"<>|]/g, '').trim() || 'file.xlsx';
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const res = await Filesystem.writeFile({ path: safe, data: toBase64(buf), directory: Directory.Cache, recursive: true });
    try {
      await Share.share({ title: safe, files: [res.uri], dialogTitle: 'حفظ أو مشاركة الملف' });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}

/** Keep the iOS status bar text readable on the current theme. */
export async function syncStatusBar(theme: 'light' | 'dark') {
  if (!isNative()) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => undefined);
}
