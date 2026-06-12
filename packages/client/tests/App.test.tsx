import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { App } from '../src/App';

describe('App', () => {
  it('renders DayStream heading', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(screen.getByText('DayStream')).toBeInTheDocument();
  });

  it('shows connecting message initially', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(screen.getByText('Connecting to API...')).toBeInTheDocument();
  });
});
