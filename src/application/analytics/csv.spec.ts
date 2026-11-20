import { csvField, toCsv } from './csv';

describe('csv', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    );
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-2')).toBe("'-2");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('\tcmd')).toBe("'\tcmd");
  });

  it('quotes commas, quotes and newlines, and leaves plain text alone', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('plain')).toBe('plain');
    expect(csvField(null)).toBe('');
    expect(csvField(0)).toBe('0');
  });

  it('builds rows with CRLF endings', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
