import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AUTH_HEADLINE, AUTH_POINTS, AuthLayout } from './AuthLayout';

function renderAt(path: string, showSwitch: boolean) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthLayout showSwitch={showSwitch}>
        <h1>Form</h1>
      </AuthLayout>
    </MemoryRouter>,
  );
}

describe('AuthLayout', () => {
  it('shows the headline and the three SRS points next to the form', () => {
    renderAt('/login', true);
    expect(screen.getByText(AUTH_HEADLINE)).toBeInTheDocument();
    expect(AUTH_POINTS).toHaveLength(3);
    for (const point of AUTH_POINTS) expect(screen.getByText(point)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Form' })).toBeInTheDocument(); // the form keeps the page's only h1
  });

  it('marks the current page in the Log in / Sign up switch', () => {
    renderAt('/register', true);
    const account = within(screen.getByRole('navigation', { name: 'Account' }));
    expect(account.getByRole('link', { name: 'Sign up' })).toHaveAttribute('aria-current', 'page');
    expect(account.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('has no switch on the other logged-out pages', () => {
    renderAt('/verify-otp', false);
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument();
  });
});
