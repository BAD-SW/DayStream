import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageSelect } from '../src/components/LanguageSelect';

describe('LanguageSelect with the business languages', () => {
  it('offers only the languages given', () => {
    render(<LanguageSelect value="en" onChange={() => {}} languages={['en']} aria-label="language" />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveValue('en');
  });

  it('still shows a stored value that is not offered', () => {
    render(<LanguageSelect value="es" onChange={() => {}} languages={['en']} aria-label="language" />);
    const select = screen.getByLabelText('language');
    expect(select).toHaveValue('es');
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['en', 'es']);
  });
});
