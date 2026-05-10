export function normalizeDrugText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactDrugText(value) {
  return normalizeDrugText(value).replace(/\s+/g, '')
}

function drugTokens(value) {
  return normalizeDrugText(value)
    .split(' ')
    .filter(Boolean)
}

function drugInitialism(value) {
  return drugTokens(value)
    .map(token => token[0])
    .join('')
}

function drugSignature(value) {
  return drugTokens(value)
    .map(token => token[0] + token.slice(1).replace(/[aeiou]/g, ''))
    .join('')
}

function isSubsequence(query, target) {
  if (!query || !target) return false
  let cursor = 0
  for (const char of target) {
    if (char === query[cursor]) cursor += 1
    if (cursor >= query.length) return true
  }
  return false
}

function candidateStrings(value) {
  const normalized = normalizeDrugText(value)
  if (!normalized) return []

  return [
    normalized,
    compactDrugText(value),
    drugInitialism(value),
    drugSignature(value),
  ].filter(Boolean)
}

export function matchesDrugSearch(query, item) {
  const normalizedQuery = normalizeDrugText(query)
  if (!normalizedQuery) return true

  const compactQuery = compactDrugText(query)
  const candidates = [
    ...(typeof item === 'string' ? candidateStrings(item) : []),
    ...(typeof item === 'object' && item
      ? [
          ...candidateStrings(item.drug_name || item.name),
          ...candidateStrings(item.generic_name),
          ...candidateStrings(item.category),
          ...candidateStrings(item.strength),
        ]
      : []),
  ]

  return candidates.some(candidate => {
    if (candidate.includes(normalizedQuery) || candidate.includes(compactQuery)) return true
    if (compactQuery.length < 2) return false
    return isSubsequence(compactQuery, candidate)
  })
}

export function findInventoryMatch(name, inventory = []) {
  if (!name || !Array.isArray(inventory) || inventory.length === 0) return null

  const query = normalizeDrugText(name)
  const queryCompact = compactDrugText(name)
  if (!query) return null

  const scored = inventory
    .map(item => {
      const drug = normalizeDrugText(item.drug_name)
      const generic = normalizeDrugText(item.generic_name)
      const drugCompact = compactDrugText(item.drug_name)
      const genericCompact = compactDrugText(item.generic_name)
      const drugInitials = drugInitialism(item.drug_name)
      const genericInitials = drugInitialism(item.generic_name)
      const drugSig = drugSignature(item.drug_name)
      const genericSig = drugSignature(item.generic_name)
      let score = -1

      if (drug === query) score = 100
      else if (generic && generic === query) score = 95
      else if (drugCompact && drugCompact === queryCompact) score = 92
      else if (genericCompact && genericCompact === queryCompact) score = 88
      else if (queryCompact.length >= 2 && drugInitials === queryCompact) score = 86
      else if (queryCompact.length >= 2 && genericInitials === queryCompact) score = 84
      else if (queryCompact.length >= 2 && isSubsequence(queryCompact, drugSig)) score = 80
      else if (queryCompact.length >= 2 && isSubsequence(queryCompact, genericSig)) score = 78
      else if (drug.startsWith(query)) score = 80
      else if (generic && generic.startsWith(query)) score = 75
      else if (drug.includes(query)) score = 60
      else if (generic && generic.includes(query)) score = 55
      else if (query.includes(drug) && drug) score = 45
      else if (query.includes(generic) && generic) score = 40
      else if (matchesDrugSearch(query, item)) score = 35

      return { item, score }
    })
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.item || null
}

export function canonicalizePrescriptionDrug(name, inventory = []) {
  const match = findInventoryMatch(name, inventory)
  return match?.drug_name || String(name || '').trim()
}

export function getDrugAvailability(name, qty, inventory = []) {
  const match = findInventoryMatch(name, inventory)
  const needed = Math.max(1, Number(qty || 1))
  if (!match) {
    return { label: 'No matching inventory found', color: '#B91C1C', match: null }
  }

  const balance = Number(match.quantity_in_stock || 0)
  if (balance <= 0) {
    return { label: 'Out of stock', color: '#B91C1C', match }
  }
  if (balance < needed) {
    return { label: `Low stock - ${balance} available`, color: '#C2410C', match }
  }
  return { label: `In stock - ${balance} available`, color: '#16A34A', match }
}
