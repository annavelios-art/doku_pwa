import { useEffect, useState } from 'react'

function isoToGerman(value) {
  if (!value) return ''

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) return value

  const [, year, month, day] = match
  return `${day}.${month}.${year}`
}

function germanToIso(value) {
  const text = String(value || '').trim()

  if (!text) {
    return {
      valid: true,
      iso: '',
    }
  }

  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)

  if (!match) {
    return {
      valid: false,
      iso: '',
    }
  }

  let [, dayText, monthText, yearText] = match

  const day = Number(dayText)
  const month = Number(monthText)

  let year = Number(yearText)

  if (yearText.length === 2) {
    year += year >= 50 ? 1900 : 2000
  }

  const date = new Date(year, month - 1, day)

  const isRealDate =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day

  if (!isRealDate) {
    return {
      valid: false,
      iso: '',
    }
  }

  return {
    valid: true,
    iso: [
      String(year).padStart(4, '0'),
      String(month).padStart(2, '0'),
      String(day).padStart(2, '0'),
    ].join('-'),
  }
}

export default function DateInput({ value, onChange }) {
  const [text, setText] = useState(() => isoToGerman(value))
  const [error, setError] = useState('')

  useEffect(() => {
    setText(isoToGerman(value))
  }, [value])

  function commitDate() {
    const result = germanToIso(text)

    if (!result.valid) {
      setError('Bitte Datum als TT.MM.JJJJ eingeben.')
      return
    }

    setError('')
    onChange(result.iso)

    if (result.iso) {
      setText(isoToGerman(result.iso))
    }
  }

  return (
    <div className="stack-sm">
      <input
        type="text"
        className="field"
        inputMode="numeric"
        placeholder="TT.MM.JJJJ"
        value={text}
        onChange={event => {
          setText(event.target.value)
          setError('')
        }}
        onBlur={commitDate}
      />

      {error && <p className="msg msg-error">{error}</p>}
    </div>
  )
}