export function isoToGermanDate(value) {
  if (!value || !value.includes('-')) return value || ''
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

export function germanDateToIso(value) {
  const text = value.trim()
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)

  if (!match) return value

  const [, day, month, year] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export default function DateInput({
  value,
  onChange,
  className = 'field',
  placeholder = 'TT.MM.JJJJ',
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      placeholder={placeholder}
      value={isoToGermanDate(value)}
      onChange={event => onChange(germanDateToIso(event.target.value))}
    />
  )
}