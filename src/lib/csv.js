// Escapes a single CSV field per RFC 4180: wrap in quotes if it contains a
// comma, quote, or newline, doubling any internal quotes.
export function escapeCsvField(value) {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"'
  return str
}

// columns: [{ key, label }]
export function rowsToCsv(rows, columns) {
  const header = columns.map(c => escapeCsvField(c.label)).join(',')
  const lines = rows.map(row => columns.map(c => escapeCsvField(row[c.key])).join(','))
  return [header, ...lines].join('\r\n')
}

export function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
