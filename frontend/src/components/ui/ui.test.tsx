import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Pill } from './Pill';
import { ProgressSegments } from './ProgressSegments';

describe('UI components', () => {
  it('Button is a real <button> and defaults to type="button" (no accidental form submits)', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('Pill is plain text, or a toggle button when clickable', () => {
    const { rerender } = render(<Pill>Past paper</Pill>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <Pill variant="active" pressed onClick={() => {}}>
        All
      </Pill>,
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ProgressSegments draws one bar per step and reports progress to screen readers', () => {
    const { container } = render(<ProgressSegments total={5} current={3} label="Quiz progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Quiz progress' });
    expect(bar).toHaveAttribute('aria-valuetext', '3 of 5');
    expect(container.querySelectorAll('[role="progressbar"] > span')).toHaveLength(5);
  });

  it('EmptyState shows a heading, text and actions', () => {
    render(
      <EmptyState title="Nothing yet" description="Ask a question.">
        <Button>Start</Button>
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument();
    expect(screen.getByText('Ask a question.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});
