import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { emptyCode, fillDigits, OtpInput } from './OtpInput';

/** The input with real state, like the verify page uses it; shows the code so tests can read it. */
function Harness({ initial = emptyCode() }: { initial?: string[] }) {
  const [digits, setDigits] = useState(initial);
  return (
    <>
      <OtpInput value={digits} onChange={setDigits} />
      <output data-testid="code">{digits.map((d) => d || '_').join('')}</output>
    </>
  );
}

const box = (n: number) => screen.getByLabelText(`Digit ${n} of 6`);
const code = () => screen.getByTestId('code').textContent;

describe('fillDigits', () => {
  it('writes digits from a box onward, skipping anything that is not a digit', () => {
    expect(fillDigits(emptyCode(), 0, '12 3-4')).toEqual({ boxes: ['1', '2', '3', '4', '', ''], focus: 4 });
  });

  it('stops at the last box and keeps the focus there', () => {
    expect(fillDigits(emptyCode(), 4, '9876')).toEqual({ boxes: ['', '', '', '', '9', '8'], focus: 5 });
  });
});

describe('OtpInput', () => {
  it('has six labelled boxes and starts in the first one', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Verification code' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(box(1)).toHaveFocus();
  });

  it('moves to the next box after each digit and ignores letters', async () => {
    render(<Harness />);
    await userEvent.keyboard('1a2');
    expect(code()).toBe('12____');
    expect(box(3)).toHaveFocus();
  });

  it('fills every box when a whole code is pasted, even into a later box', async () => {
    render(<Harness />);
    await userEvent.click(box(3));
    await userEvent.paste('123 456');
    expect(code()).toBe('123456');
    expect(box(6)).toHaveFocus();
  });

  it('pastes a partial code from the box the cursor is in', async () => {
    render(<Harness />);
    await userEvent.click(box(2));
    await userEvent.paste('78');
    expect(code()).toBe('_78___');
    expect(box(4)).toHaveFocus();
  });

  it('Backspace clears the current digit, then on an empty box goes back and clears the one before', async () => {
    render(<Harness initial={['1', '2', '3', '', '', '']} />);
    await userEvent.click(box(3));

    await userEvent.keyboard('{Backspace}'); // box 3 had a digit: clear it, stay
    expect(code()).toBe('12____');
    expect(box(3)).toHaveFocus();

    await userEvent.keyboard('{Backspace}'); // box 3 is empty: clear box 2 and move there
    expect(code()).toBe('1_____');
    expect(box(2)).toHaveFocus();
  });

  it('typing into a filled box replaces its digit', async () => {
    render(<Harness initial={['1', '2', '3', '4', '5', '6']} />);
    await userEvent.click(box(2));
    await userEvent.keyboard('9');
    expect(code()).toBe('193456');
    expect(box(3)).toHaveFocus();
  });
});
