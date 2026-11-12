// Spots common misspellings of popular email domains ("gmial.com",
// "yaho.com", "gmail.con") and suggests the fix. Used where an admin types
// someone's email, since admin-entered emails are trusted without a
// verification link.

const FIXES: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.in': 'gmail.com',
  'gmail.om': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yhoo.com': 'yahoo.com',
  'yaoo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.co.in',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'outloo.com': 'outlook.com',
  'rediffmai.com': 'rediffmail.com',
  'redifmail.com': 'rediffmail.com',
  'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com',
}

export function suggestEmailFix(email: string): string | null {
  const v = email.trim().toLowerCase()
  const at = v.lastIndexOf('@')
  if (at < 1) return null
  const domain = v.slice(at + 1)
  let fixed = FIXES[domain]
  if (!fixed && domain.endsWith('.con')) fixed = `${domain.slice(0, -4)}.com`
  return fixed ? `${v.slice(0, at)}@${fixed}` : null
}
