import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { IconClose } from './Icons';

export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop" />
        <Dialog.Popup className="sheet glass">
          <div className="sheet__grip" aria-hidden />
          <div className="sheet__head">
            <Dialog.Title render={<h2 />}>{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="إغلاق"><IconClose aria-hidden /></Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
