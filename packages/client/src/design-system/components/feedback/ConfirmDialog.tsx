import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from '../actions/Button';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'primary';
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message,
  confirmLabel, cancelLabel,
  variant = 'destructive',
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{cancelLabel ?? t('cancel')}</Button>
          <Button variant={variant} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel ?? t('confirm')}</Button>
        </>
      }
    >
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
        {message}
      </p>
    </Modal>
  );
}
