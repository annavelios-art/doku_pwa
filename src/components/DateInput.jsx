export function isoToGermanDate(value) {
  if (!value || !value.includes('-')) return value || ''

  const [year, month, day] = value.split('-')

  if (!year || !month || !day) return value

  return `${day}.${month}.${year}`
}

export function germanDateToIso(value) {
  const text = String(value || '').trim()

  const match = text.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/
  )

  if (!match) return value

  const [, dayText, monthText, yearText] = match

  const day = Number(dayText)
  const month = Number(monthText)

  let year = Number(yearText)

  if (yearText.length === 2) {
    year += year >= 50 ? 1900 : 2000
  }

  const testDate = new Date(year, month - 1, day)

  const isValid =
    testDate.getFullYear() === year &&
    testDate.getMonth() === month - 1 &&
    testDate.getDate() === day

  if (!isValid) return value

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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
      onChange={event =>
        onChange(germanDateToIso(event.target.value))
      }
    />
  )
}