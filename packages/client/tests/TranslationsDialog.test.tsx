import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { TranslationsDialog } from '../src/components/TranslationsTable';
import * as api from '../src/api/translations';
import * as dialogs from '../src/design-system/components/feedback/dialogs';

vi.mock('../src/api/translations', () => ({ getTranslations: vi.fn(), saveTranslation: vi.fn(), machineTranslate: vi.fn() }));
vi.mock('../src/context/ContextManager', () => ({ useContextManager: () => ({ activeContext: { businessId: 'b1' } }) }));
vi.mock('../src/design-system/components/feedback/dialogs', () => ({ askConfirm: vi.fn(), showMessage: vi.fn() }));

const getTranslations = api.getTranslations as unknown as ReturnType<typeof vi.fn>;
const saveTranslation = api.saveTranslation as unknown as ReturnType<typeof vi.fn>;
const machineTranslate = api.machineTranslate as unknown as ReturnType<typeof vi.fn>;
const askConfirm = dialogs.askConfirm as unknown as ReturnType<typeof vi.fn>;
const showMessage = dialogs.showMessage as unknown as ReturnType<typeof vi.fn>;

const table = (esName = '') => ({
  entityType: 'addon', fields: ['name', 'description'], defaultLanguage: 'en',
  original: { name: 'Hot stones', description: 'Warm basalt stones' },
  rows: [{ language: 'es', fields: esName ? { name: esName, description: '' } : {}, translatedBy: esName ? 'person' : null, outOfDate: false, updatedAt: null }],
});

function open() {
  return render(<TranslationsDialog open onClose={() => {}} entityType="addon" entityId="a1" title="Hot stones" />);
}

describe('TranslationsDialog (Phase 44, requirement 9)', () => {
  beforeEach(() => { getTranslations.mockResolvedValue(table()); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('shows the default language read only, then a row per other language', async () => {
    open();
    const def = await screen.findByTestId('row-default');
    expect(within(def).getByText('English')).toBeInTheDocument();
    expect(within(def).getByText('Hot stones')).toBeInTheDocument();
    expect(within(def).queryAllByRole('textbox')).toHaveLength(0);
    const es = screen.getByTestId('row-es');
    expect(within(es).getByText('Español')).toBeInTheDocument();
    expect(within(es).getAllByRole('textbox')).toHaveLength(2);
    expect(within(es).queryByText('Not translated')).toBeNull();
    expect(within(es).queryByText('Out of date')).toBeNull();
    expect(getTranslations).toHaveBeenCalledWith('b1', 'addon', 'a1');
  });

  it('fills a row from the machine translation and saves it as machine', async () => {
    machineTranslate.mockResolvedValue({ name: 'Piedras calientes', description: 'Piedras de basalto' });
    saveTranslation.mockResolvedValue({});
    open();
    const es = await screen.findByTestId('row-es');
    const save = screen.getAllByText('Save')[0].closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(es).getByText('Translate'));
    await waitFor(() => expect((within(es).getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Piedras calientes'));
    expect(machineTranslate).toHaveBeenCalledWith('b1', 'addon', 'a1', 'es');
    expect(askConfirm).not.toHaveBeenCalled();
    expect(within(es).queryByText('Translated by Google')).toBeNull();
    fireEvent.click(screen.getAllByText('Save')[0]);
    await waitFor(() => expect(saveTranslation).toHaveBeenCalledWith('b1', 'addon', 'a1', 'es', { name: 'Piedras calientes', description: 'Piedras de basalto' }, 'machine'));
    await waitFor(() => expect(getTranslations).toHaveBeenCalledTimes(2));
  });

  it('saves an edited row as person', async () => {
    saveTranslation.mockResolvedValue({});
    open();
    const es = await screen.findByTestId('row-es');
    fireEvent.change(within(es).getAllByRole('textbox')[0], { target: { value: 'Piedras' } });
    fireEvent.click(screen.getAllByText('Save')[1]);
    await waitFor(() => expect(saveTranslation).toHaveBeenCalledWith('b1', 'addon', 'a1', 'es', { name: 'Piedras', description: '' }, 'person'));
  });

  it('asks before replacing text and shows the server refusal', async () => {
    getTranslations.mockResolvedValue(table('Piedras'));
    askConfirm.mockResolvedValue(true);
    machineTranslate.mockRejectedValue({ response: { data: { error: 'Daily limit reached' } } });
    open();
    const es = await screen.findByTestId('row-es');
    fireEvent.click(within(es).getByText('Translate'));
    await waitFor(() => expect(showMessage).toHaveBeenCalledWith({ message: 'Daily limit reached', tone: 'error' }));
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Replace' }));
    expect((within(es).getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Piedras');
  });
});
