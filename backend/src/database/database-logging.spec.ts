import { maskEmail } from '../auth/mask-email';
import { describeMongoUri } from './database-logging';

describe('describeMongoUri (startup log)', () => {
  it('shows database and host, never the user name or password', () => {
    const text = describeMongoUri('mongodb+srv://student:S3cretPass@cluster0.abc.mongodb.net/medprep?retryWrites=true');
    expect(text).toBe('medprep on cluster0.abc.mongodb.net');
    expect(text).not.toContain('S3cretPass');
    expect(text).not.toContain('student');
  });

  it('handles a local URI without credentials', () => {
    expect(describeMongoUri('mongodb://127.0.0.1:27017/medprep_e2e')).toBe('medprep_e2e on 127.0.0.1:27017');
  });

  it('says when no database name is given (MongoDB would use "test")', () => {
    expect(describeMongoUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/?retryWrites=true')).toBe(
      '(default database "test") on cluster0.abc.mongodb.net',
    );
  });
});

describe('maskEmail (login failure log)', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskEmail('ayesha.khan@example.com')).toBe('a***@example.com');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});
