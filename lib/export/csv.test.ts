import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { csvCell, csvRow } from './csv.ts'

describe('csvCell — formula injection', () => {
  it('neutralizes each formula trigger without dropping content', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`)
    assert.equal(csvCell('+cmd'), "'+cmd")
    assert.equal(csvCell('-1+1'), "'-1+1")
    assert.equal(csvCell('@SUM(A1:A9)'), "'@SUM(A1:A9)")
    assert.equal(csvCell('\tcmd'), "'\tcmd")
    assert.equal(csvCell('\rcmd'), `"'\rcmd"`)
  })

  it('does not alter harmless text', () => {
    assert.equal(csvCell('texto normal'), 'texto normal')
    assert.equal(csvCell('a=b'), 'a=b')
    assert.equal(csvCell('João da Conceição'), 'João da Conceição')
  })

  it('keeps numeric values numeric, including negatives', () => {
    assert.equal(csvCell(-5), '-5')
    assert.equal(csvCell(0), '0')
  })
})

describe('csvCell — CSV escaping', () => {
  it('quotes and doubles embedded quotes', () => {
    assert.equal(csvCell('"texto normal"'), '"""texto normal"""')
  })

  it('quotes the ; separator', () => {
    assert.equal(csvCell('João; Silva'), '"João; Silva"')
  })

  it('preserves legitimate line breaks inside quotes', () => {
    assert.equal(csvCell('linha 1\nlinha 2'), '"linha 1\nlinha 2"')
    assert.equal(csvCell('linha 1\r\nlinha 2'), '"linha 1\r\nlinha 2"')
  })

  it('renders empty values as empty cells', () => {
    assert.equal(csvCell(''), '')
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(undefined), '')
  })

  it('a multiline cell starting with a trigger is both neutralized and quoted', () => {
    assert.equal(csvCell('=1+1\nfoo'), `"'=1+1\nfoo"`)
  })
})

describe('csvRow', () => {
  it('joins cells with ; and sanitizes each one', () => {
    assert.equal(csvRow(['=x', 'João; Silva', 3, null]), `'=x;"João; Silva";3;`)
  })
})
