import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';
import { ResetPasswordDto } from './verify-otp.dto';
import { ListUsersQueryDto, UpdateRoleDto } from '../../users/dto/account.dto';

async function errorsFor<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('RegisterDto', () => {
  const good = { name: 'Ayesha Khan', email: 'ayesha@example.com', password: 'secret123' };

  it('accepts a valid body', async () => {
    expect(await errorsFor(RegisterDto, good)).toEqual([]);
  });

  it('trims the name and lowercases the email', () => {
    const dto = plainToInstance(RegisterDto, { ...good, name: '  Ayesha  ', email: ' AYESHA@Example.COM ' });
    expect(dto.name).toBe('Ayesha');
    expect(dto.email).toBe('ayesha@example.com');
  });

  it.each([
    ['name too short', { ...good, name: 'A' }, 'name'],
    ['invalid email', { ...good, email: 'not-an-email' }, 'email'],
    ['password too short', { ...good, password: 'abc12' }, 'password'],
    ['password without a number', { ...good, password: 'onlyletters' }, 'password'],
    ['password longer than 72', { ...good, password: 'a1'.repeat(40) }, 'password'],
  ])('rejects %s', async (_label, body, field) => {
    expect(await errorsFor(RegisterDto, body)).toContain(field);
  });
});

describe('LoginDto', () => {
  it('accepts a valid body', async () => {
    expect(await errorsFor(LoginDto, { email: 'a@b.com', password: 'x' })).toEqual([]);
  });

  it('rejects an empty password', async () => {
    expect(await errorsFor(LoginDto, { email: 'a@b.com', password: '' })).toContain('password');
  });
});

describe('ResetPasswordDto', () => {
  const good = { email: ' A@B.com ', code: ' 123456 ', newPassword: 'newpass12' };

  it('accepts a valid body and normalises the email and code', async () => {
    expect(await errorsFor(ResetPasswordDto, good)).toEqual([]);
    expect(plainToInstance(ResetPasswordDto, good)).toMatchObject({ email: 'a@b.com', code: '123456' });
  });

  it.each([
    ['a weak password', { ...good, newPassword: 'onlyletters' }, 'newPassword'],
    ['a 5-digit code', { ...good, code: '12345' }, 'code'],
  ])('rejects %s', async (_label, body, field) => {
    expect(await errorsFor(ResetPasswordDto, body)).toContain(field);
  });
});

describe('ListUsersQueryDto', () => {
  it('defaults to page 1, 20 per page, and turns query strings into numbers', async () => {
    expect(plainToInstance(ListUsersQueryDto, {})).toMatchObject({ page: 1, limit: 20 });
    expect(plainToInstance(ListUsersQueryDto, { page: '3', limit: '50' })).toMatchObject({ page: 3, limit: 50 });
  });

  it('rejects more than 50 per page and page 0', async () => {
    expect(await errorsFor(ListUsersQueryDto, { limit: '51' })).toContain('limit');
    expect(await errorsFor(ListUsersQueryDto, { page: '0' })).toContain('page');
  });
});

describe('UpdateRoleDto', () => {
  it('only allows student or admin', async () => {
    expect(await errorsFor(UpdateRoleDto, { role: 'admin' })).toEqual([]);
    expect(await errorsFor(UpdateRoleDto, { role: 'instructor' })).toContain('role');
  });
});
