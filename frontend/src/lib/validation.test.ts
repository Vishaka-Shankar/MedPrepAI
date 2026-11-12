import { describe, expect, it } from 'vitest';
import { nameProblem } from './validation';

describe('nameProblem (sign up and edit profile)', () => {
  it.each(['Ayesha Khan', 'Abdul-Rahman', "O'Brien", 'M. Ali', 'Syed Ali Jr.', 'Zoë', 'عائشہ خان', '  Ayesha   Khan  '])(
    'accepts %s',
    (name) => {
      expect(nameProblem(name)).toBeNull();
    },
  );

  it.each([
    ['A', 'Name must be 2 to 80 characters.'],
    ['a'.repeat(81), 'Name must be 2 to 80 characters.'],
    ['Ayesha123', 'Name cannot contain numbers.'],
    ['12345', 'Name cannot contain numbers.'],
    ['Ali@Khan!', "Name can only contain letters, spaces, hyphens (-), apostrophes (') and dots."],
    ['#$%&', "Name can only contain letters, spaces, hyphens (-), apostrophes (') and dots."],
    ['-Ali', "Name can only contain letters, spaces, hyphens (-), apostrophes (') and dots."],
    ['Ali--Khan', "Name can only contain letters, spaces, hyphens (-), apostrophes (') and dots."],
    ['ali_khan', "Name can only contain letters, spaces, hyphens (-), apostrophes (') and dots."],
  ])('rejects %s', (name, message) => {
    expect(nameProblem(name)).toBe(message);
  });
});
